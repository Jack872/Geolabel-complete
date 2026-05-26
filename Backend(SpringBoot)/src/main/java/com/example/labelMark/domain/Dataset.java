package com.example.labelMark.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.io.Serializable;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;
import org.springframework.data.annotation.Id;

import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;

/**
 * <p>
 * 数据集实体类
 * </p>
 *
 */
@Getter
@Setter
@TableName("dataset")
@ApiModel(value = "Dataset对象", description = "数据集信息")
public class Dataset implements Serializable {

    private static final long serialVersionUID = 1L;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @TableId(value = "id", type = IdType.AUTO)
    private Integer id;

    @ApiModelProperty("样本集名称")
    @TableField("name")
    private String name;

    @ApiModelProperty("样本集描述")
    @TableField("description")
    private String description;

    @ApiModelProperty("样本集缩略图")
    @TableField("thumb_url")
    private String thumbUrl;

    @ApiModelProperty("样本集数量")
    @TableField("sample_num")
    private Integer sampleNum;

    @ApiModelProperty("联系人")
    @TableField("contact")
    private String contact;

    @ApiModelProperty("邮箱")
    @TableField("email")
    private String email;

    @ApiModelProperty("包含类别")
    @TableField("sorts")
    private String sorts;

    @ApiModelProperty("用户ID")
    @TableField("user_id")
    private Integer userId;

    @ApiModelProperty("任务类型")
    @TableField("task_type")
    private String taskType;

    @ApiModelProperty("年份")
    @TableField("year")
    private String year;

    @ApiModelProperty("影像集类型: service=服务影像集, local=本地影像集")
    @TableField("set_type")
    private String setType;

}
