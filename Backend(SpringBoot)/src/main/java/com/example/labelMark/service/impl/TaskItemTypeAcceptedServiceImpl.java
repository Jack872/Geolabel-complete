package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.domain.TaskItemTypeAccepted;
import com.example.labelMark.mapper.TaskItemTypeAcceptedMapper;
import com.example.labelMark.service.TaskItemTypeAcceptedService;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class TaskItemTypeAcceptedServiceImpl
        extends ServiceImpl<TaskItemTypeAcceptedMapper, TaskItemTypeAccepted>
        implements TaskItemTypeAcceptedService {

    @Override
    public List<TaskItemTypeAccepted> listByTaskId(Integer taskId) {
        if (taskId == null) return Collections.emptyList();
        return list(new QueryWrapper<TaskItemTypeAccepted>()
                .eq("task_id", taskId)
                .orderByAsc("task_item_id", "user_id", "type_id"));
    }

    @Override
    public List<TaskItemTypeAccepted> listByTaskItem(Integer taskId, Integer taskItemId) {
        if (taskId == null || taskItemId == null) return Collections.emptyList();
        return list(new QueryWrapper<TaskItemTypeAccepted>()
                .eq("task_id", taskId)
                .eq("task_item_id", taskItemId)
                .orderByAsc("user_id", "type_id"));
    }

    @Override
    public List<TaskItemTypeAccepted> listByTaskItemAndUser(Integer taskId, Integer taskItemId, Integer userId) {
        if (taskId == null || taskItemId == null || userId == null) return Collections.emptyList();
        return list(new QueryWrapper<TaskItemTypeAccepted>()
                .eq("task_id", taskId)
                .eq("task_item_id", taskItemId)
                .eq("user_id", userId)
                .orderByAsc("type_id"));
    }

    @Override
    public Set<Integer> getAssignedTypeIds(Integer taskId, Integer taskItemId, Integer userId) {
        return listByTaskItemAndUser(taskId, taskItemId, userId).stream()
                .map(TaskItemTypeAccepted::getTypeId)
                .filter(v -> v != null)
                .collect(Collectors.toSet());
    }

    @Override
    public boolean isTypeAssigned(Integer taskId, Integer taskItemId, Integer userId, Integer typeId) {
        if (typeId == null) return false;
        return count(new QueryWrapper<TaskItemTypeAccepted>()
                .eq("task_id", taskId)
                .eq("task_item_id", taskItemId)
                .eq("user_id", userId)
                .eq("type_id", typeId)) > 0;
    }

    @Override
    public void deleteByTaskId(Integer taskId) {
        if (taskId == null) return;
        remove(new QueryWrapper<TaskItemTypeAccepted>().eq("task_id", taskId));
    }

    @Override
    public void deleteByTaskItem(Integer taskId, Integer taskItemId) {
        if (taskId == null || taskItemId == null) return;
        remove(new QueryWrapper<TaskItemTypeAccepted>()
                .eq("task_id", taskId)
                .eq("task_item_id", taskItemId));
    }

    @Override
    public int markFinished(Integer taskId, Integer taskItemId, Integer userId, boolean finished) {
        if (taskId == null || taskItemId == null || userId == null) return 0;
        UpdateWrapper<TaskItemTypeAccepted> wrapper = new UpdateWrapper<TaskItemTypeAccepted>()
                .eq("task_id", taskId)
                .eq("task_item_id", taskItemId)
                .eq("user_id", userId)
                .set("is_finished", finished)
                .set("finished_at", finished ? new Date() : null);
        update(wrapper);
        return (int) count(new QueryWrapper<TaskItemTypeAccepted>()
                .eq("task_id", taskId)
                .eq("task_item_id", taskItemId)
                .eq("user_id", userId)
                .eq("is_finished", finished));
    }
}

