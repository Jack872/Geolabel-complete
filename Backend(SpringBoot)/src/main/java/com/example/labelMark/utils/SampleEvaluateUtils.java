package com.example.labelMark.utils;

import com.alibaba.fastjson.JSONObject;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.Lineal;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.linearref.LengthIndexedLine;
import org.wololo.jts2geojson.GeoJSONReader;

/**
 * @Description
 * @Author wh
 * @Date 2025/11/18
 */
public class SampleEvaluateUtils {
    /**
     * 【推荐】计算边界误差，使用对称差面积。
     * 这种方法精确、高效，能完美度量两个图形的几何差异区域。
     * @param g1 几何体1
     * @param g2 几何体2
     * @return 对称差的面积
     */
    public static double boundaryErrorBySymmetricDifference(Geometry g1, Geometry g2) {
        if (g1 == null || g2 == null || !g1.isValid() || !g2.isValid()) {
            return 0.0;
        }
        // symDifference 计算的结果就是两个图形不重合部分的总和
        return g1.symDifference(g2).getArea();
    }
    /**
     * 通过在边界上采样点来估算平均边界距离。
     * 注意：这种方法是估算值，且对于复杂图形可能效率较低。
     * @param g1 几何体1
     * @param g2 几何体2
     * @return 估算的平均边界距离
     */
    public static double boundaryError(Geometry g1, Geometry g2) {
        if (g1 == null || g2 == null) return 0.0;

        Geometry b1 = g1.getBoundary();
        Geometry b2 = g2.getBoundary();

        // 确保边界是线状的 (例如 Polygon 的边界是 LineString)
        if (!(b1 instanceof Lineal) || b1.isEmpty()) {
            return 0.0;
        }

        // 使用 LengthIndexedLine 来在边界上精确采样点
        LengthIndexedLine indexedLine = new LengthIndexedLine(b1);
        double lineLength = b1.getLength();

        int sampleN = 200;
        double totalDistance = 0;

        for (int i = 0; i < sampleN; i++) {
            // 计算沿线段的距离
            double distanceAlongLine = lineLength * ((double) i / sampleN);
            Coordinate sampleCoord = indexedLine.extractPoint(distanceAlongLine);

            // 将坐标转换为 Point 对象以使用 distance 方法
            Point samplePoint = g1.getFactory().createPoint(sampleCoord);
            double distanceToOtherBoundary = samplePoint.distance(b2);
            totalDistance += distanceToOtherBoundary;
        }

        return sampleN == 0 ? 0 : totalDistance / sampleN;
    }

    public static double calculateIoU(Geometry g1, Geometry g2) {
        if (g1 == null || g2 == null) return 0.0;

        Geometry inter = g1.intersection(g2);
        Geometry union = g1.union(g2);

        double interArea = inter.getArea();
        double unionArea = union.getArea();

        if (unionArea == 0) return 0.0;

        return interArea / unionArea;
    }

    /**
     * 使用 jts2geojson 库解析 GeoJSON。
     * @param json 包含 GeoJSON 数据的 JSONObject
     * @return JTS Geometry 对象
     */
    public static Geometry parseGeoJson(JSONObject json) {
        if (json == null) {
            return null;
        }

        String type = json.getString("type");
        if (type == null) {
            throw new RuntimeException("GeoJSON 格式错误：缺少 type 字段");
        }
        JSONObject geom = json.getJSONObject("geometry");
        // 1. 实例化新的 GeoJSONReader
        GeoJSONReader reader = new GeoJSONReader();
        try {
            // 2. 将 JSONObject 转换为字符串，然后读取
            return reader.read(geom.toString());
        } catch (Exception e) {
            // 3. 捕获通用的 Exception，因为新库不抛出 ParseException
            throw new RuntimeException("GeoJSON 解析失败: " + e.getMessage(), e);
        }
    }
}
