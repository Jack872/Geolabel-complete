package com.example.labelMark.DTO.sample;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * @Description
 * @Author wh
 * @Date 2025/12/17
 */
// 1. 根对象
@Data
public class DatasetMeta {
    private String datasetName;
    private String createTime;
    private List<MetaCategory> categories = new ArrayList<>();
    private List<MetaImage> images = new ArrayList<>();
}

