package com.example.labelMark.utils;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.convert.Convert;
import cn.hutool.core.map.MapBuilder;
import cn.hutool.core.map.MapUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import com.example.labelMark.domain.Mark;
import com.example.labelMark.domain.Type;
import com.example.labelMark.service.TypeService;
import com.alibaba.fastjson.JSONObject;

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;


public class CoordinateConverter {
    @Resource
    static
    TypeService typeService;

    //转化坐标信息（geojson）
    public static List<Map<String, Object>> convertCoordinate(List<Map<String, Object>> geojsonArr) {
        List<Map<String, Object>> geometryArr = new ArrayList<>();

        for (Map<String, Object> item : geojsonArr) {
            String geoJson = (String) item.get("geoJson");
            Integer typeId = (Integer) item.get("typeId");

            if (geoJson != null) {
                // Parse the GeoJSON to extract feature information
                JSONObject geoJsonObj = JSONObject.parseObject(geoJson);
                List<JSONObject> features = geoJsonObj.getJSONArray("features").toJavaList(JSONObject.class);

                for (JSONObject feature : features) {
                    // Extract markId from properties
                    JSONObject properties = feature.getJSONObject("properties");
                    String markId = properties != null && properties.containsKey("markId")
                        ? properties.getString("markId")
                        : null;
                    JSONObject safeProperties = properties == null ? new JSONObject() : new JSONObject(properties);
                    safeProperties.remove("markId");
                    JSONObject attrJson = parseAttrJson(safeProperties);
                    safeProperties.remove("attrJson");
                    safeProperties.remove("attr_json");

                    // Extract geometry and store it directly as a JSON string
                    JSONObject geometry = feature.getJSONObject("geometry");

                    // Create and store the geometry map
                    Map<String, Object> geometryMap = new HashMap<>();
                    // Store the geometry as a string directly, without extra serialization
                    geometryMap.put("geom", geometry.toString());
                    geometryMap.put("typeId", typeId);
                    geometryMap.put("markId", markId);
                    geometryMap.put("properties", safeProperties.toJSONString());
                    geometryMap.put("attrJson", attrJson == null ? null : attrJson.toJSONString());

                    geometryArr.add(geometryMap);
                }
            }
        }

        return geometryArr;
    }

    //处理标注信息
    public static List<Map<String, Object>> processMarkInfo(List<Map<String, Object>> geometryArr, List<Type> typeArr) {
        List<Map<String, Object>> markInfoArr = new ArrayList<>();

        for (Type type : typeArr) {
            markInfoArr = geometryArr.stream()
                    .filter(item -> type.getTypeId().equals(item.get("typeId")))
                    .collect(Collectors.toList());
        }
        return markInfoArr;

        // 处理 markInfoArr，例如保存数据到数据库
        // ...
    }

    public static List<Map<String, Object>> convertGeojson(List<Mark> marks) {
        List<Map<String, Object>> list = new ArrayList<>();
        marks.forEach(mark -> {
            Map<String, Object> markGeoJson = MapUtil.builder(new HashMap<String, Object>())
                    .put("typeId", mark.getTypeId())
                    .put("markId", mark.getId())
                    .put("userId", mark.getUserId())
                    .put("feedback", mark.getFeedback())
                    .put("markGeoJson", mark.getGeom())
                    .put("attrJson", mark.getAttrJson())
                    .build();
            list.add(markGeoJson);
        });
        return list;
    }

    private static JSONObject parseAttrJson(JSONObject safeProperties) {
        if (safeProperties == null) {
            return null;
        }
        Object rawAttr = safeProperties.get("attrJson");
        if (rawAttr == null) {
            rawAttr = safeProperties.get("attr_json");
        }
        if (rawAttr == null) {
            return null;
        }
        if (rawAttr instanceof JSONObject) {
            return (JSONObject) rawAttr;
        }
        if (rawAttr instanceof Map) {
            return new JSONObject((Map<String, Object>) rawAttr);
        }
        try {
            return JSONObject.parseObject(String.valueOf(rawAttr));
        } catch (Exception ignored) {
            return null;
        }
    }
}
