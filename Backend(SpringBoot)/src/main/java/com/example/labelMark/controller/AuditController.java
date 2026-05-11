package com.example.labelMark.controller;

import com.example.labelMark.DTO.AuditPassRequestDTO;
import com.example.labelMark.service.AuditInfoService;
import com.example.labelMark.service.MarkService;
import com.example.labelMark.service.TaskService;
import com.example.labelMark.utils.ResultGenerator;
import com.example.labelMark.vo.constant.Result;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.Map;

/**
 * @Description
 * @Author wh
 * @Date 2025/11/14
 */
@RestController
@RequestMapping("/audit")
public class AuditController {
    @Resource
    AuditInfoService auditInfoService;
    @PostMapping("/submitAuditFail")
    @Transactional(rollbackFor = Exception.class)
    public Result submitAuditFail(@RequestBody Map<String, Object> req) {
        auditInfoService.submitAuditFail(req);
        return ResultGenerator.getSuccessResult("审核不通过，已反馈");
    }

    @PostMapping("/submitAuditPass")
    @Transactional(rollbackFor = Exception.class)
    public Result submitAuditPass(@RequestBody AuditPassRequestDTO request) {
        auditInfoService.submitAuditPass(request);
        return ResultGenerator.getSuccessResult("审核已通过");
    }
    @GetMapping("/getAuditInfo")
    @Transactional(rollbackFor = Exception.class)
    public Result getAuditInfo(@RequestParam String taskId) {

        return auditInfoService.getAuditInfo(taskId);
    }
}
