package com.example.labelMark.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.domain.TaskItemTypeAccepted;

import java.util.List;
import java.util.Set;

public interface TaskItemTypeAcceptedService extends IService<TaskItemTypeAccepted> {
    List<TaskItemTypeAccepted> listByTaskId(Integer taskId);

    List<TaskItemTypeAccepted> listByTaskItem(Integer taskId, Integer taskItemId);

    List<TaskItemTypeAccepted> listByTaskItemAndUser(Integer taskId, Integer taskItemId, Integer userId);

    Set<Integer> getAssignedTypeIds(Integer taskId, Integer taskItemId, Integer userId);

    boolean isTypeAssigned(Integer taskId, Integer taskItemId, Integer userId, Integer typeId);

    void deleteByTaskId(Integer taskId);

    void deleteByTaskItem(Integer taskId, Integer taskItemId);

    int markFinished(Integer taskId, Integer taskItemId, Integer userId, boolean finished);
}

