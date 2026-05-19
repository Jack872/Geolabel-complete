package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.example.labelMark.DTO.MergeMultipartRequest;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.domain.Dataset;
import com.example.labelMark.domain.FileMetadata;
import com.example.labelMark.domain.Server;
import com.example.labelMark.domain.SysFile;
import com.example.labelMark.mapper.FileMetadataMapper;
import com.example.labelMark.mapper.ServerMapper;
import com.example.labelMark.mapper.SysFileMapper;
import com.example.labelMark.service.DatasetService;
import com.example.labelMark.service.GeoServerService;
import com.example.labelMark.service.ProvenanceService;
import com.example.labelMark.service.SysFileService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.*;
import java.util.stream.Collectors;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 *
 * @since 2024-04-18
 */
@Service
public class SysFileServiceImpl extends ServiceImpl<SysFileMapper, SysFile> implements SysFileService {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Resource
    private SysFileMapper sysfileMapper;
    @Resource
    private FileMetadataMapper fileMetadataMapper;

    @Resource
    @Lazy// 如果存在循环依赖，加上 Lazy
    private SysFileService sysfileService;
    @Resource
    private DatasetService datasetService;
    @Resource
    private ProvenanceService provenanceService;
    @Resource
    private ServerMapper serverMapper;
    @Resource
    private GeoServerService geoServerService;

    @Override
    public List<SysFile> getFilesData(Integer current, Integer pageSize, Integer datasetId, Integer userId) {
        int offset = pageSize * (current - 1);

        // 如果是普通用户，只返回自己上传的文件
        return sysfileMapper.getFilesByUserId(current, pageSize, datasetId, offset, userId);
    }

    @Override
    public Integer countFilesData(Integer datasetId, Integer userId) {
        Integer total = sysfileMapper.countFilesByUserId(datasetId, userId);
        return total == null ? 0 : total;
    }

    @Override
    public void updateFile(Integer fileId, String fileName, String updateTime) {
        sysfileMapper.updateFile(fileId, fileName, updateTime);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteFile(String fileName) {
        QueryWrapper<SysFile> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("file_name", fileName);
        List<SysFile> toDelete = sysfileMapper.selectList(queryWrapper);
        sysfileMapper.delete(queryWrapper);

        if (toDelete != null && !toDelete.isEmpty()) {
            // 同步回写影像集数量
            Map<Integer, Long> datasetDecreaseMap = toDelete.stream()
                    .filter(f -> f.getDatasetId() != null)
                    .collect(Collectors.groupingBy(SysFile::getDatasetId, Collectors.counting()));
            for (Map.Entry<Integer, Long> entry : datasetDecreaseMap.entrySet()) {
                Dataset dataset = datasetService.getById(entry.getKey());
                if (dataset != null) {
                    int currentNum = dataset.getSampleNum() == null ? 0 : dataset.getSampleNum();
                    int newNum = Math.max(0, currentNum - entry.getValue().intValue());
                    dataset.setSampleNum(newNum);
                    datasetService.editDataSet(dataset);
                }
            }

            List<String> fileIds = toDelete.stream()
                    .map(SysFile::getFileId)
                    .filter(Objects::nonNull)
                    .map(String::valueOf)
                    .collect(Collectors.toList());
            if (!fileIds.isEmpty()) {
                provenanceService.deleteByBusinessIdsAndTypes(
                        fileIds,
                        Collections.singletonList("RAW_IMAGE")
                );
            }
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteFileById(Integer fileId) {
        if (fileId == null) {
            return;
        }
        SysFile file = sysfileMapper.selectById(fileId);
        if (file == null) {
            return;
        }

        // 如果影像已发布，先清理 server 和 GeoServer
        if (file.getStatus() != null && file.getStatus() == 1) {
            QueryWrapper<Server> serverQuery = new QueryWrapper<>();
            serverQuery.eq("ser_desc", file.getFileName());
            Server server = serverMapper.selectOne(serverQuery);
            if (server != null) {
                try {
                    geoServerService.deleteStore(server.getSerName());
                } catch (Exception e) {
                    System.err.println("删除 GeoServer store 失败: " + server.getSerName() + ", err=" + e.getMessage());
                }
                serverMapper.delete(serverQuery);
            }
        }

        sysfileMapper.deleteById(fileId);

        if (file.getDatasetId() != null) {
            Dataset dataset = datasetService.getById(file.getDatasetId());
            if (dataset != null) {
                int currentNum = dataset.getSampleNum() == null ? 0 : dataset.getSampleNum();
                dataset.setSampleNum(Math.max(0, currentNum - 1));
                datasetService.editDataSet(dataset);
            }
        }

        provenanceService.deleteByBusinessIdsAndTypes(
                Collections.singletonList(String.valueOf(fileId)),
                Collections.singletonList("RAW_IMAGE")
        );
    }

    @Override
    public boolean updateFileStatus(String fileName,Integer status) {
        UpdateWrapper<SysFile> wrapper = new UpdateWrapper<>();
        wrapper.eq("file_name", fileName).set("status", status);
        boolean update = update(wrapper);
        return update;
    }

    @Override
    public SysFile getFileByFileName(String fileName) {
        QueryWrapper<SysFile> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("file_name", fileName);
        return sysfileMapper.selectOne(queryWrapper);
    }

    @Override
    public SysFile getFileById(Integer fileId) {
        return sysfileMapper.selectById(fileId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Integer saveFileAndProvenance(MergeMultipartRequest data, Integer userId, String updatetime) {
        // 1. 在数据库中创建文件记录
        SysFile sysFile = new SysFile();
        sysFile.setFileName(data.getFileName());
        sysFile.setUpdateTime(updatetime);
        sysFile.setSize(data.getFileSize());
        sysFile.setUserId(userId);
        sysFile.setSetName(data.getSetName());
        sysFile.setDatasetId(data.getDatasetId());
        sysFile.setStatus(0);
        sysfileService.save(sysFile); // 保存后 sysFile 会自动获得 fileId
        Integer fileId = sysFile.getFileId();

        // 2. 更新数据集内的影像数量
        Dataset dataset = datasetService.getById(data.getDatasetId());
        if (dataset != null) {
            int sampleNum = dataset.getSampleNum() == null ? 0 : dataset.getSampleNum();
            dataset.setSampleNum(sampleNum + 1);
            datasetService.editDataSet(dataset);
        }

        // 3. 保存影像元数据
        FileMetadata fileMetadata = buildFileMetadata(data, fileId);
        fileMetadataMapper.upsertFileMetadata(fileMetadata);

        // 4. 记录溯源信息
        Map<String, Object> entityAttrs = new HashMap<>();
        putIfNotBlank(entityAttrs, "user_note", data.getDescription());
        putIfNotBlank(entityAttrs, "coordinate_system", data.getCoordinateSystem());
        putIfNotBlank(entityAttrs, "crs_name", data.getCrsName());
        putIfNotBlank(entityAttrs, "acquisition_time_start", data.getAcquisitionTimeStart());
        putIfNotBlank(entityAttrs, "sensor_platform", data.getSensorPlatform());
        putIfNotBlank(entityAttrs, "provider", data.getProvider());
        if (data.getBandCount() != null) {
            entityAttrs.put("band_count", data.getBandCount());
        }

        // 统一 RAW_IMAGE 的 business_id 语义：固定使用 file_id，便于和后续 PUBLISH_SERVICE 串联
        ProvEntityRef outputEntity = ProvEntityRef.of(
                fileId.toString(),
                "RAW_IMAGE",
                data.getFileName()
        );
        outputEntity.setAttributes(entityAttrs);

        String normalizedTimePrecision = normalizeTimePrecision(data.getTimePrecision());

        Map<String, Object> activityParams = new HashMap<>();
        activityParams.put("fileSize", data.getFileSize());
        activityParams.put("datasetId", data.getDatasetId());
        activityParams.put("customDesc", data.getDescription());
        putIfNotBlank(activityParams, "coordinateSystem", data.getCoordinateSystem());
        putIfNotBlank(activityParams, "timePrecision", normalizedTimePrecision);
        putIfNotBlank(activityParams, "timeZone", data.getTimeZone());
        putIfNotBlank(activityParams, "bandsJson", fileMetadata.getBandsJson());
        putIfNotBlank(activityParams, "processingLevel", data.getProcessingLevel());

        provenanceService.recordActivity(
                "UPLOAD",
                userId.toString(),
                "PERSON",
                null,// 没有输入实体（这是源头）
                Collections.singletonList(outputEntity),
                activityParams
        );

        return fileId;
    }

    private FileMetadata buildFileMetadata(MergeMultipartRequest data, Integer fileId) {
        FileMetadata metadata = new FileMetadata();
        metadata.setFileId(fileId);
        metadata.setCrsCode(trimToNull(data.getCoordinateSystem()));
        metadata.setCrsName(trimToNull(data.getCrsName()));
        metadata.setAcquisitionTimeStart(trimToNull(data.getAcquisitionTimeStart()));
        metadata.setAcquisitionTimeEnd(trimToNull(data.getAcquisitionTimeEnd()));
        metadata.setTimePrecision(normalizeTimePrecision(data.getTimePrecision()));
        metadata.setTimeZone(trimToNull(data.getTimeZone()));
        metadata.setSensorPlatform(trimToNull(data.getSensorPlatform()));
        metadata.setProvider(trimToNull(data.getProvider()));
        metadata.setBandCount(data.getBandCount());
        metadata.setBandsJson(normalizeBandsJson(data.getBandsJson()));
        metadata.setWidthPx(data.getWidthPx());
        metadata.setHeightPx(data.getHeightPx());
        metadata.setPixelSizeX(data.getPixelSizeX());
        metadata.setPixelSizeY(data.getPixelSizeY());
        metadata.setDataType(trimToNull(data.getDataType()));
        metadata.setNodataValue(trimToNull(data.getNodataValue()));
        metadata.setCloudCover(data.getCloudCover());
        metadata.setProcessingLevel(trimToNull(data.getProcessingLevel()));
        metadata.setLicense(trimToNull(data.getLicense()));
        metadata.setUsageScope(trimToNull(data.getUsageScope()));
        metadata.setUploadDescription(trimToNull(data.getDescription()));
        metadata.setRemark(trimToNull(data.getRemark()));
        metadata.setExt(extractExt(data.getFileName()));
        return metadata;
    }

    private String extractExt(String fileName) {
        if (fileName == null || fileName.trim().isEmpty()) {
            return null;
        }
        int dotIndex = fileName.lastIndexOf('.');
        if (dotIndex < 0 || dotIndex == fileName.length() - 1) {
            return null;
        }
        return fileName.substring(dotIndex + 1).toLowerCase(Locale.ROOT);
    }

    private String normalizeBandsJson(String raw) {
        String trimmed = trimToNull(raw);
        if (trimmed == null) {
            return null;
        }
        try {
            Object parsed = OBJECT_MAPPER.readValue(trimmed, Object.class);
            if (parsed instanceof List) {
                return OBJECT_MAPPER.writeValueAsString(parsed);
            }
        } catch (Exception ignored) {
            // 尝试按逗号分隔兜底
        }

        List<String> bands = Arrays.stream(trimmed.split("[,，\\n]"))
                .map(String::trim)
                .filter(item -> !item.isEmpty())
                .collect(Collectors.toList());
        if (bands.isEmpty()) {
            return null;
        }
        try {
            return OBJECT_MAPPER.writeValueAsString(bands);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String normalizeTimePrecision(String raw) {
        String value = trimToNull(raw);
        if (value == null) {
            return null;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        switch (normalized) {
            case "年":
            case "yyyy":
            case "year":
                return "year";
            case "月":
            case "month":
                return "month";
            case "天":
            case "日":
            case "day":
                return "day";
            case "小时":
            case "小時":
            case "hour":
                return "hour";
            case "分钟":
            case "分鐘":
            case "minute":
            case "min":
                return "minute";
            case "秒":
            case "second":
            case "sec":
                return "second";
            default:
                return null;
        }
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private void putIfNotBlank(Map<String, Object> target, String key, String value) {
        String normalized = trimToNull(value);
        if (normalized != null) {
            target.put(key, normalized);
        }
    }

}
