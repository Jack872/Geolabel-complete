package com.example.labelMark.domain;

import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.example.labelMark.config.JsonObjectTypeHandler;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;
import org.apache.ibatis.type.JdbcType;

import java.io.Serializable;

@Getter
@Setter
@TableName("attribute_def")
@ApiModel(value = "AttributeDef对象", description = "属性定义")
public class AttributeDef implements Serializable {
    private static final long serialVersionUID = 1L;

    @TableId(value = "attr_id", type = IdType.AUTO)
    private Integer attrId;

    @ApiModelProperty("属性唯一key，如 area/floors/usage")
    @TableField("attr_key")
    private String attrKey;

    @ApiModelProperty("属性名称")
    @TableField("attr_name")
    private String attrName;

    @ApiModelProperty("属性类型：string/number/integer/enum")
    @TableField("data_type")
    private String dataType;

    @ApiModelProperty("枚举选项(JSON数组)")
    @TableField(value = "enum_options_json", typeHandler = JsonObjectTypeHandler.class, jdbcType = JdbcType.OTHER)
    private JSONObject enumOptionsJson;

    @ApiModelProperty("单位")
    @TableField("unit")
    private String unit;

    @ApiModelProperty("是否启用")
    @TableField("is_active")
    private Boolean isActive;

    @ApiModelProperty("备注")
    @TableField("remark")
    private String remark;
}

