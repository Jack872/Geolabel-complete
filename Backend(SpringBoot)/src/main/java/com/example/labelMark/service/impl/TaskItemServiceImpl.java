package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.domain.TaskItem;
import com.example.labelMark.mapper.TaskItemMapper;
import com.example.labelMark.service.TaskItemService;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

@Service
public class TaskItemServiceImpl extends ServiceImpl<TaskItemMapper, TaskItem> implements TaskItemService {

    @Override
    public List<TaskItem> listByTaskId(Integer taskId) {
        if (taskId == null) {
            return Collections.emptyList();
        }
        return list(new QueryWrapper<TaskItem>()
                .eq("task_id", taskId)
                .orderByAsc("item_index", "task_item_id"));
    }

    @Override
    public TaskItem getDefaultItem(Integer taskId) {
        return getOne(new QueryWrapper<TaskItem>()
                .eq("task_id", taskId)
                .orderByAsc("item_index", "task_item_id")
                .last("LIMIT 1"));
    }

    @Override
    public TaskItem resolveTaskItem(Integer taskId, Integer taskItemId) {
        if (taskItemId != null) {
            TaskItem taskItem = getById(taskItemId);
            if (taskItem != null && taskId != null && taskId.equals(taskItem.getTaskId())) {
                return taskItem;
            }
        }
        return getDefaultItem(taskId);
    }
}
