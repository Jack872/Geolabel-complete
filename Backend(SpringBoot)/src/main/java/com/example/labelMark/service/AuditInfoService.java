package com.example.labelMark.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.DTO.AuditPassRequestDTO;
import com.example.labelMark.domain.AuditInfo;
import com.example.labelMark.vo.constant.Result;

import java.util.Map;

/**
 * @Description
 * @Author wh
 * @Date 2025/11/17
 */
public interface AuditInfoService extends IService<AuditInfo> {
    public Result submitAuditFail(Map<String, Object> req);
    public Result submitAuditPass(AuditPassRequestDTO request);

    Result getAuditInfo(String taskId);
}
