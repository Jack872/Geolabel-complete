package com.example.labelMark.service;

import com.example.labelMark.domain.Mark;
import com.baomidou.mybatisplus.extension.service.IService;

import java.util.List;
import java.util.Map;

/**
 * <p>
 *  服务类
 * </p>
 *
 *
 * @since 2024-04-28
 */
public interface MarkService extends IService<Mark> {

    boolean isMark(int taskId, int userId);

    void insertOrUpdateMark(Mark mark);

    List<Mark> getMarkByTaskId(Integer taskId);

    void deleteMarkByTaskId(int taskId);

    List<Mark> selectMarkById(int taskId);

    long GetTaskIdNum(int taskId);


    void deleteMarkByTaskAndUser(int taskId, int userId);

    /**
     * 增量保存标注信息（包含新增、更新、删除）并处理唯一提交者逻辑
     * @param request 前端传来的 Map 参数
     * @return 操作结果描述
     */
    String saveMarkInfoIncremental(Map<String, Object> request) throws Exception;
}
