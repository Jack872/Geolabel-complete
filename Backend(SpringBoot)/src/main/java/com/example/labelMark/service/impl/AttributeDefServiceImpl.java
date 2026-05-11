package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.domain.AttributeDef;
import com.example.labelMark.mapper.AttributeDefMapper;
import com.example.labelMark.service.AttributeDefService;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Service
public class AttributeDefServiceImpl extends ServiceImpl<AttributeDefMapper, AttributeDef> implements AttributeDefService {
    private static final long CACHE_TTL_MS = 60_000L;
    private static volatile List<AttributeDef> activeCache = Collections.emptyList();
    private static volatile long cacheAt = 0L;

    @Override
    public List<AttributeDef> listActiveAttributeDefs() {
        long now = System.currentTimeMillis();
        if (now - cacheAt <= CACHE_TTL_MS && activeCache != null && !activeCache.isEmpty()) {
            return new ArrayList<>(activeCache);
        }
        List<AttributeDef> list = this.list(new QueryWrapper<AttributeDef>()
                .eq("is_active", true)
                .orderByAsc("attr_id"));
        activeCache = list == null ? Collections.emptyList() : list;
        cacheAt = now;
        return new ArrayList<>(activeCache);
    }
}

