package com.example.labelMark.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.domain.DatasetStore;
import com.example.labelMark.domain.SampleSet;

import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * @Description
 * @Author wh
 * @Date 2025/12/16
 */

public interface SampleSetService extends IService<SampleSet> {

    int createMergedDataset(List<Integer> taskIds, String datasetName, Map<String, Object> params) throws IOException;

    IPage<SampleSet> listVisibleSampleSets(Integer pageNum, Integer pageSize, String name);

    SampleSet getReadableSampleSet(Integer id);

    void deleteSampleSets(List<Integer> ids);

    void downloadSampleSet(Integer id, String format, Map<String, Object> exportOptions, HttpServletResponse response) throws Exception;

    Map<String, Object> exportSampleSet(Integer id, String format, Map<String, Object> exportOptions) throws Exception;

    Map<String, Object> getDatasetProvenance(Integer id);
}
