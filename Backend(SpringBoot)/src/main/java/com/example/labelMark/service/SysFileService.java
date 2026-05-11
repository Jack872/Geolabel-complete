package com.example.labelMark.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.DTO.MergeMultipartRequest;
import com.example.labelMark.domain.SysFile;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * <p>
 * 服务类
 * </p>
 *
 *
 * @since 2024-05-16
 */
public interface SysFileService extends IService<SysFile> {

    List<SysFile> getFilesData(Integer current, Integer pageSize, Integer datasetId, Integer userId);

    Integer countFilesData(Integer datasetId, Integer userId);

    void updateFile(Integer fileId, String fileName, String updateTime);

    void deleteFile(String fileName);

    void deleteFileById(Integer fileId);


    boolean updateFileStatus(String fileName,Integer status);

    SysFile getFileByFileName(String fileName);

    SysFile getFileById(Integer fileId);

    @Transactional(rollbackFor = Exception.class)
    void saveFileAndProvenance(MergeMultipartRequest data, Integer userId, String updatetime);
}
