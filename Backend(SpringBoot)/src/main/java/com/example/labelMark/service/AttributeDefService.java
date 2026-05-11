package com.example.labelMark.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.example.labelMark.domain.AttributeDef;

import java.util.List;

public interface AttributeDefService extends IService<AttributeDef> {
    List<AttributeDef> listActiveAttributeDefs();
}

