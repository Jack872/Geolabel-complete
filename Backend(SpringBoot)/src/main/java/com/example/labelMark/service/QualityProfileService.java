package com.example.labelMark.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.DTO.quality.QualityProfileSaveRequest;
import com.example.labelMark.domain.QualityProfile;

import java.util.List;
import java.util.Map;

public interface QualityProfileService extends IService<QualityProfile> {
    List<Map<String, Object>> listProfiles(String taskType, Boolean onlyActive);
    Map<String, Object> getProfileDetail(Long id);
    Map<String, Object> saveProfile(QualityProfileSaveRequest request, String operator);
    Map<String, Object> updateProfile(Long id, QualityProfileSaveRequest request, String operator);
}
