package com.example.labelMark.utils;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.DTO.sample.DatasetMeta;
import com.example.labelMark.config.TaskNotificationHandler;
import com.example.labelMark.domain.*;
import com.example.labelMark.mapper.ProvActivityMapper;
import com.example.labelMark.mapper.ProvAgentMapper;
import com.example.labelMark.mapper.ProvEntityMapper;
import com.example.labelMark.mapper.ProvRelationMapper;
import com.example.labelMark.service.ProvenanceService;
import com.example.labelMark.vo.LoginUser;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.text.SimpleDateFormat;
import java.util.*;

/**
 * @Description
 * @Author wh
 * @Date 2025/12/22
 */
@Component
public class ProvUtils {
    @Autowired
    private ProvAgentMapper agentMapper;
    @Autowired private ProvEntityMapper entityMapper;
    @Autowired private ProvRelationMapper relationMapper;


    private static final Logger logger = LoggerFactory.getLogger(ProvUtils.class);

    public String getOrCreateAgent(String externalId, String type) {
        // 1. 先查
        ProvAgent agent = agentMapper.selectOne(new QueryWrapper<ProvAgent>()
                .eq("external_id", externalId)
                .eq("agent_type", type));
        if (agent != null) return agent.getId();

        // 2. 没查到，准备插入
        agent = new ProvAgent();
        agent.setExternalId(externalId);
        agent.setAgentType(type);
        agent.setAgentName("Agent_" + externalId);
        agent.setCreatedAt(new Date());

        try {
            agentMapper.insert(agent);
            return agent.getId();
        } catch (DuplicateKeyException e) {
            // 3. 并发冲突处理：如果插入报错，说明刚才被别人插进去了，再查一次即可
            ProvAgent exists = agentMapper.selectOne(new QueryWrapper<ProvAgent>()
                    .eq("external_id", externalId)
                    .eq("agent_type", type));
            return exists != null ? exists.getId() : null; // 理论上一定不为null
        }
    }

    public String getOrCreateEntity(ProvEntityRef ref) {
        // 1. 先查库
        ProvEntity entity = entityMapper.selectOne(new QueryWrapper<ProvEntity>()
                .eq("business_id", ref.getBusinessId())
                .eq("entity_type", ref.getEntityType()));

        // 2. 如果存在，直接返回ID
        if (entity != null) return entity.getId();

        // 3. 不存在，准备插入
        entity = new ProvEntity();
        entity.setBusinessId(ref.getBusinessId());
        entity.setEntityType(ref.getEntityType());
        entity.setLabel(ref.getLabel() != null ? ref.getLabel() : "Unknown Entity");
        entity.setLocation(ref.getLocation());
        entity.setAttributes(ref.getAttributes()); // MyBatis-Plus TypeHandler 会自动处理 Map -> JSON
        entity.setCreatedAt(new Date());

        try {
            entityMapper.insert(entity);
            return entity.getId();
        } catch (DuplicateKeyException e) {
            // 4. 并发冲突：插入失败说明刚刚被别的线程插入了，重新查询
            ProvEntity exists = entityMapper.selectOne(new QueryWrapper<ProvEntity>()
                    .eq("business_id", ref.getBusinessId())
                    .eq("entity_type", ref.getEntityType()));
            if (exists != null) {
                return exists.getId();
            }
            // 极低概率：如果重查还为空（比如刚插完就被删了），抛出异常或返回null
            throw new RuntimeException("Failed to get or create ProvEntity: " + ref.getBusinessId(), e);
        }
    }

    /**
     * 创建关联关系 (简单插入)
     */
    public void createRelation(String actId, String entId, String type, String role) {
        // 简单参数校验，防止脏数据入库
        if (actId == null || entId == null) {
            System.err.println("Warning: Skip creating relation due to null ID. ActId=" + actId + ", EntId=" + entId);
            return;
        }

        ProvRelation rel = new ProvRelation();
        rel.setActivityId(actId);
        rel.setEntityId(entId);
        rel.setRelType(type);
        rel.setRole(role);
        rel.setCreatedAt(new Date());

        // Relation 表通常只有自增主键，允许 (actId, entId) 重复（比如多次使用同一文件）
        // 所以这里直接 insert 即可，无需 DuplicateKey 判断
        relationMapper.insert(rel);
    }

    public String generateDesc(String actType, Map<String, Object> params) {
        // 简单生成描述，可优化
        return String.format("Performed %s action", actType);
    }

    /**
     * 根据指定的格式生成对应的标注文件和目录结构
     *
     * @param format      导出格式 (YOLO, VOC, COCO, DML等)
     * @param meta        数据集元数据对象
     * @param tempRoot    临时打包的根目录
     * @param datasetName 数据集名称 (用于DML格式命名)
     * @throws IOException
     */
    public void generateAnnotationFiles(String format, DatasetMeta meta, Path tempRoot, String datasetName) throws IOException {

        if ("YOLO".equalsIgnoreCase(format)) {
            // YOLO 格式通常需要一个 labels 文件夹，每张图片对应一个 .txt 文件
            Path tempLabels = tempRoot.resolve("labels");
            Files.createDirectories(tempLabels);
            SampleUtils.generateYoloLabels(meta, tempLabels);

        } else if ("VOC".equalsIgnoreCase(format)) {
            // VOC 格式通常需要一个 Annotations 文件夹，每张图片对应一个 .xml 文件
            Path xmlDir = tempRoot.resolve("Annotations");
            Files.createDirectories(xmlDir);
            SampleUtils.generateVocLabels(meta, xmlDir);

        } else if ("DML".equalsIgnoreCase(format) || "TDML".equalsIgnoreCase(format)) {
            // TDML 统一输出为 trainingdml.json；完整语义分割打包逻辑由 SampleSetServiceImpl 负责。
            Path tdmlJsonPath = tempRoot.resolve("trainingdml.json");
            SampleUtils.generateTdmlJson(meta, tdmlJsonPath);

        } else {
            // 默认导出为标准的 COCO 格式：annotations.json
            Path cocoJsonPath = tempRoot.resolve("annotations.json");
            SampleUtils.generateCocoJson(meta, cocoJsonPath);
        }
    }

    public void generateProvMetadataFile(SampleSet sampleSet, String format, DatasetMeta meta, Path tempRoot,List<ProvActivity> history) {
        try {
            Map<String, Object> provJson = new LinkedHashMap<>();
            ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

            // A. 基础声明
            Map<String, Object> manifest = new HashMap<>();
            manifest.put("datasetName", sampleSet.getName());
            manifest.put("exportFormat", format);
            manifest.put("generatedAt", new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()));
            provJson.put("manifest", manifest);

            // B. 溯源图实体与活动 (核心：提取历史记录)
            // 1. 提取任务列表
            String taskIdsStr = sampleSet.getTaskIds().replace("[", "").replace("]", "").replace(" ", "");
            List<Map<String, Object>> activityLogs = new ArrayList<>();
            if (!taskIdsStr.isEmpty()) {
                for (ProvActivity act : history) {
                    Map<String, Object> node = new HashMap<>();
                    node.put("id", act.getId());
                    node.put("type", act.getActType());
                    node.put("agent", act.getAgentId());
                    node.put("time", act.getStartTime());
                    node.put("properties", act.getParameters()); // 这里存储了 iou, boundaryError 等
                    activityLogs.add(node);
                }
            }
            // 核心修正：只在这里 put 一次
            provJson.put("provenance_history", activityLogs);
            // C. 数据集摘要
            Map<String, Object> stats = new HashMap<>();
            stats.put("imageCount", meta.getImages().size());
            stats.put("taskType", sampleSet.getTaskType());
            provJson.put("statistics", stats);

            // 写入文件
            Files.write(tempRoot.resolve("provenance.json"),
                    mapper.writeValueAsBytes(provJson),
                    StandardOpenOption.CREATE);

        } catch (Exception e) {
            logger.warn("生成溯源元文件失败: " + e.getMessage());
        }
    }

}

