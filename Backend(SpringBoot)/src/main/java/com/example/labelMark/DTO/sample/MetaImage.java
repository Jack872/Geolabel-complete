package com.example.labelMark.DTO.sample;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * @Description
 * @Author wh
 * @Date 2025/12/17
 */
// 3. 图片定义
@Data
public class MetaImage {
    private int id; // 全局唯一ID
    private String fileName; // 原始大图文件名 (便于追溯)
    private int originalTaskId;
    // 该大图下切出的所有小图对象
    private List<MetaObject> objects = new ArrayList<>();
}
