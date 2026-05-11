package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.domain.ProvActivity;
import com.example.labelMark.domain.ProvAgent;
import com.example.labelMark.domain.ProvEntity;
import com.example.labelMark.domain.ProvRelation;
import com.example.labelMark.mapper.ProvActivityMapper;
import com.example.labelMark.mapper.ProvAgentMapper;
import com.example.labelMark.mapper.ProvEntityMapper;
import com.example.labelMark.mapper.ProvRelationMapper;
import com.example.labelMark.service.ProvenanceService;
import com.example.labelMark.utils.ProvUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class ProvenanceServiceImpl implements ProvenanceService {

    @Autowired
    private ProvAgentMapper agentMapper;
    @Autowired private ProvEntityMapper entityMapper;
    @Autowired private ProvActivityMapper activityMapper;
    @Autowired private ProvRelationMapper relationMapper;
    @Autowired private ProvUtils provUtils;


    @Override
    @Transactional(rollbackFor = Exception.class)
    public String recordActivity(String actType, String externalAgentId, String agentType,
                                 List<ProvEntityRef> inputs, List<ProvEntityRef> outputs,
                                 Map<String, Object> params) {

        // 1. 确保 Agent 存在 (如果不存在则自动创建，或者查缓存)
        String provAgentId = provUtils.getOrCreateAgent(externalAgentId, agentType);

        // 2. 创建 Activity 记录
        ProvActivity activity = new ProvActivity();
        activity.setActType(actType);
        activity.setAgentId(provAgentId);
//        TODO 细致的时间统计，比如记录一个上传文件的准确开始和结束时间
        activity.setStartTime(new Date());
        activity.setParameters(params);
        activity.setStatus("SUCCESS");
        activity.setDescription(provUtils.generateDesc(actType, params));
        activityMapper.insert(activity);

        // 3. 处理输入实体 (USED)
        if (inputs != null) {
            for (ProvEntityRef ref : inputs) {
                String entityId = provUtils.getOrCreateEntity(ref);
                provUtils.createRelation(activity.getId(), entityId, "USED", null);
            }
        }

        // 4. 处理输出实体 (GENERATED)
        if (outputs != null) {
            for (ProvEntityRef ref : outputs) {
                String entityId = provUtils.getOrCreateEntity(ref);
                provUtils.createRelation(activity.getId(), entityId, "GENERATED", null);
            }
        }

        return activity.getId();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteByBusinessIdsAndTypes(List<String> businessIds, List<String> entityTypes) {
        if (businessIds == null || businessIds.isEmpty() || entityTypes == null || entityTypes.isEmpty()) {
            return;
        }

        List<ProvEntity> targetEntities = entityMapper.selectList(
                new QueryWrapper<ProvEntity>()
                        .in("business_id", businessIds)
                        .in("entity_type", entityTypes)
        );
        if (targetEntities == null || targetEntities.isEmpty()) {
            return;
        }

        List<String> entityIds = targetEntities.stream()
                .map(ProvEntity::getId)
                .collect(Collectors.toList());

        List<ProvRelation> relations = relationMapper.selectList(
                new QueryWrapper<ProvRelation>().in("entity_id", entityIds)
        );
        Set<String> affectedActivityIds = relations == null
                ? new HashSet<>()
                : relations.stream().map(ProvRelation::getActivityId).collect(Collectors.toSet());

        relationMapper.delete(new QueryWrapper<ProvRelation>().in("entity_id", entityIds));
        entityMapper.delete(new QueryWrapper<ProvEntity>().in("id", entityIds));

        if (!affectedActivityIds.isEmpty()) {
            List<ProvRelation> remainRelations = relationMapper.selectList(
                    new QueryWrapper<ProvRelation>().in("activity_id", affectedActivityIds)
            );
            Set<String> aliveActivityIds = remainRelations == null
                    ? Collections.emptySet()
                    : remainRelations.stream().map(ProvRelation::getActivityId).collect(Collectors.toSet());

            List<String> orphanActivityIds = affectedActivityIds.stream()
                    .filter(id -> !aliveActivityIds.contains(id))
                    .collect(Collectors.toList());

            if (!orphanActivityIds.isEmpty()) {
                activityMapper.delete(new QueryWrapper<ProvActivity>().in("id", orphanActivityIds));
            }
        }
    }

}
