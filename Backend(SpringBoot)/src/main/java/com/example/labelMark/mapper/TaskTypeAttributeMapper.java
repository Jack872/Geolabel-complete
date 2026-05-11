package com.example.labelMark.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.example.labelMark.domain.TaskTypeAttribute;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

@Mapper
public interface TaskTypeAttributeMapper extends BaseMapper<TaskTypeAttribute> {

    @Select({
            "<script>",
            "SELECT",
            "  tta.id, tta.task_id, tta.type_id, tta.attr_id,",
            "  tta.is_required, tta.display_order, tta.placeholder, tta.remark,",
            "  ad.attr_key, ad.attr_name, ad.data_type, ad.enum_options_json::text AS enum_options_json, ad.unit",
            "FROM task_type_attribute tta",
            "JOIN attribute_def ad ON ad.attr_id = tta.attr_id",
            "WHERE tta.task_id = #{taskId}",
            "<if test='typeId != null'>",
            "  AND tta.type_id = #{typeId}",
            "</if>",
            "ORDER BY tta.type_id ASC, tta.display_order ASC, tta.id ASC",
            "</script>"
    })
    List<Map<String, Object>> selectTaskTypeAttributeDetails(@Param("taskId") Integer taskId, @Param("typeId") Integer typeId);
}

