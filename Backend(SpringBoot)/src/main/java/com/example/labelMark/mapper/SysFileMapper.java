package com.example.labelMark.mapper;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.example.labelMark.domain.Server;
import com.example.labelMark.domain.SysFile;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * <p>
 *  Mapper 接口
 * </p>
 *
 *
 * @since 2024-04-18
 */
@Mapper
public interface SysFileMapper extends BaseMapper<SysFile> {

    @Select({
            "<script>",
            "SELECT * FROM file",
            "ORDER BY file_id DESC",
            "LIMIT #{pageSize} OFFSET #{offset}",
            "</script>"
    })
    List<SysFile> getAllFiles(@Param("current") Integer current,
                              @Param("pageSize") Integer pageSize,
                              @Param("fileId") Integer fileId,
                              @Param("offset") int offset);

    @Select({
            "<script>",
            "SELECT f.*,",
            "       fm.crs_code AS crsCode,",
            "       fm.crs_name AS crsName,",
            "       fm.acquisition_time_start AS acquisitionTimeStart,",
            "       fm.acquisition_time_end AS acquisitionTimeEnd,",
            "       fm.time_precision AS timePrecision,",
            "       fm.time_zone AS timeZone,",
            "       fm.sensor_platform AS sensorPlatform,",
            "       fm.provider AS provider,",
            "       fm.band_count AS bandCount,",
            "       fm.bands_json AS bandsJson,",
            "       fm.width_px AS widthPx,",
            "       fm.height_px AS heightPx,",
            "       fm.pixel_size_x AS pixelSizeX,",
            "       fm.pixel_size_y AS pixelSizeY,",
            "       fm.data_type AS dataType,",
            "       fm.nodata_value AS nodataValue,",
            "       fm.cloud_cover AS cloudCover,",
            "       fm.processing_level AS processingLevel,",
            "       fm.\"license\" AS \"license\",",
            "       fm.usage_scope AS usageScope,",
            "       fm.upload_description AS uploadDescription,",
            "       fm.remark AS remark,",
            "       fm.ext AS ext",
            "FROM file f",
            "LEFT JOIN file_metadata fm ON f.file_id = fm.file_id",
            "WHERE f.user_id = #{userId}",
            "<if test='datasetId != null '>",
            "AND f.dataset_id = #{datasetId}",
            "</if>",
            "ORDER BY f.file_id DESC",
            "LIMIT #{pageSize} OFFSET #{offset}",
            "</script>"
    })
    List<SysFile> getFilesByUserId(@Param("current") Integer current,
                                   @Param("pageSize") Integer pageSize,
                                   @Param("datasetId") Integer datasetId,
                                   @Param("offset") int offset,
                                   @Param("userId") Integer userId);

    @Select({
            "<script>",
            "SELECT COUNT(1) FROM file f",
            "WHERE f.user_id = #{userId}",
            "<if test='datasetId != null '>",
            "AND f.dataset_id = #{datasetId}",
            "</if>",
            "</script>"
    })
    Integer countFilesByUserId(@Param("datasetId") Integer datasetId, @Param("userId") Integer userId);

    @Update("update SysFile set file_name=#{fileName}, update_time=#{updateTime} where file_id=#{fileId}")
    void updateFile(Integer fileId, String fileName, String updateTime);


    @Insert("INSERT INTO file(file_name, update_time, status, size, user_id, set_name,dataset_id) values (#{fileName}, #{updateTime}, 0, #{size}, #{userId}, #{setName}, #{datasetId})")
    void createFile(String fileName, String updateTime, String size, Integer userId, String setName,Integer datasetId);
}
