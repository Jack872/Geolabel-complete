package com.example.labelMark.utils;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.labelMark.domain.ProvEntity;
import com.example.labelMark.mapper.ProvEntityMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 坐标系管理工具类
 * 提供动态获取和管理坐标系的功能
 */
@Component
public class CoordinateSystemUtils {
    
    private static final Logger logger = LoggerFactory.getLogger(CoordinateSystemUtils.class);
    
    @Autowired
    private ProvEntityMapper provEntityMapper;
    @Autowired
    private CommUtils commUtils;
    
    /**
     * 从任务列表中获取坐标系信息（仅从溯源系统）
     * @param taskIds 任务ID列表
     * @return 坐标系字符串，如 "EPSG:3857"
     */
    public String getCoordinateSystemFromTasks(List<Integer> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) {
            return getDefaultCoordinateSystem();
        }
        
        try {
            // 从溯源系统中查找
            String crsFromProvenance = getCoordinateSystemFromProvenance(taskIds);
            if (crsFromProvenance != null) {
                return crsFromProvenance;
            }
            
            // 返回默认值
            return getDefaultCoordinateSystem();
        } catch (Exception e) {
            logger.error("获取坐标系失败: {}", e.getMessage());
            return getDefaultCoordinateSystem();
        }
    }
    
    /**
     * 从文件路径中获取坐标系信息
     * @param filePath TIF文件路径
     * @return 坐标系字符串，如 "EPSG:3857"
     */
    public String getCoordinateSystemFromFile(String filePath) {
        try {
            String detectedCrs = commUtils.getTiffSRS(filePath);
            if (isValidCoordinateSystem(detectedCrs)) {
                logger.info("从TIF文件获取到坐标系: {}", detectedCrs);
                return detectedCrs;
            }
            if ("UNKNOWN".equalsIgnoreCase(detectedCrs)) {
                logger.info("TIF文件未检测到有效地理坐标系，使用 NONE");
                return "NONE";
            }
        } catch (Exception e) {
            logger.warn("从文件系统获取坐标系失败: {}", e.getMessage());
        }
        return getDefaultCoordinateSystem();
    }
    
    /**
     * 从溯源系统中获取坐标系
     */
    private String getCoordinateSystemFromProvenance(List<Integer> taskIds) {
        try {
            List<String> businessIds = taskIds.stream()
                    .map(String::valueOf)
                    .collect(Collectors.toList());
            
            List<ProvEntity> entities = provEntityMapper.selectList(
                    new QueryWrapper<ProvEntity>()
                            .in("business_id", businessIds)
                            .eq("entity_type", "RAW_IMAGE")
            );
            
            for (ProvEntity entity : entities) {
                if (entity.getAttributes() != null) {
                    Object crsObj = entity.getAttributes().get("coordinate_system");
                    if (crsObj != null) {
                        String crs = crsObj.toString();
                        if (isValidCoordinateSystem(crs)) {
                            logger.info("从溯源系统获取到坐标系: {}", crs);
                            return crs;
                        }
                    }
                }
            }
        } catch (Exception e) {
            logger.warn("从溯源系统获取坐标系失败: {}", e.getMessage());
        }
        return null;
    }
    
    /**
     * 验证坐标系是否有效
     */
    private boolean isValidCoordinateSystem(String crs) {
        return crs != null &&
               ("NONE".equalsIgnoreCase(crs) ||
               "UNKNOWN".equalsIgnoreCase(crs) ||
               crs.startsWith("EPSG:") ||
               crs.startsWith("ESRI:"));
    }
    
    /**
     * 获取默认坐标系
     */
    public String getDefaultCoordinateSystem() {
        return "EPSG:3857"; // Web Mercator
    }
    
    /**
     * 获取常用坐标系列表
     */
    public List<String> getCommonCoordinateSystems() {
        return List.of(
            "NONE",       // 无坐标系（像素坐标）
            "EPSG:4326",  // WGS84
            "EPSG:3857",  // Web Mercator
            "EPSG:3301",  // Estonian Coordinate System
            "EPSG:2154",  // RGF93 / Lambert-93
            "EPSG:32633", // WGS84 / UTM zone 33N
            "EPSG:32634", // WGS84 / UTM zone 34N
            "EPSG:25832", // ETRS89 / UTM zone 32N
            "EPSG:25833"  // ETRS89 / UTM zone 33N
        );
    }
    
    /**
     * 转换坐标系代码为描述
     */
    public String getCoordinateSystemDescription(String crs) {
        if (crs == null) return "未知坐标系";
        
        switch (crs) {
            case "NONE":
                return "无坐标系（像素坐标）";
            case "UNKNOWN":
                return "未知坐标系";
            case "EPSG:4326":
                return "WGS84 地理坐标系";
            case "EPSG:3857":
                return "Web Mercator 投影坐标系";
            case "EPSG:3301":
                return "爱沙尼亚坐标系";
            case "EPSG:2154":
                return "法国 Lambert-93 投影";
            case "EPSG:32633":
                return "WGS84 UTM 33N 投影";
            case "EPSG:32634":
                return "WGS84 UTM 34N 投影";
            case "EPSG:25832":
                return "ETRS89 UTM 32N 投影";
            case "EPSG:25833":
                return "ETRS89 UTM 33N 投影";
            default:
                return crs;
        }
    }
}
