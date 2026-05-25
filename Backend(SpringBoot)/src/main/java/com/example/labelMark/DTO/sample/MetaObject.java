package com.example.labelMark.DTO.sample;

import lombok.Data;

import java.util.List;

/**
 * @Description
 * @Author wh
 * @Date 2025/12/17
 */
// 4. 切片/标注对象定义
@Data
public class MetaObject {
    private int id; // 全局唯一标注ID
    private int categoryId;
    private String categoryName;
    private String categoryColor;

    // 所有的坐标都是相对于 sliceFileName 这张小图的局部坐标
    private List<Double> bbox; // [x, y, w, h]
    private List<List<Double>> segmentation; // 多边形 [[x,y, x,y...]]

    private String sliceFileName; // 切片文件名
    private int width;  // 切片宽
    private int height; // 切片高
}
