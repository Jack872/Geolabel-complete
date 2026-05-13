package com.example.labelMark.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.domain.TaskItem;

import java.util.List;

public interface TaskItemService extends IService<TaskItem> {
    List<TaskItem> listByTaskId(Integer taskId);

    TaskItem getDefaultItem(Integer taskId);

    TaskItem resolveTaskItem(Integer taskId, Integer taskItemId);
}
