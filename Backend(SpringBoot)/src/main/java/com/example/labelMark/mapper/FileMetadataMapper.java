package com.example.labelMark.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.example.labelMark.domain.FileMetadata;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface FileMetadataMapper extends BaseMapper<FileMetadata> {

    @Insert({
            "<script>",
            "INSERT INTO file_metadata (",
            "file_id, crs_code, crs_name, acquisition_time_start, acquisition_time_end,",
            "time_precision, time_zone, sensor_platform, provider, band_count, bands_json,",
            "width_px, height_px, pixel_size_x, pixel_size_y, data_type, nodata_value,",
            "cloud_cover, processing_level, \"license\", usage_scope, upload_description, remark, ext",
            ") VALUES (",
            "#{fileId}, #{crsCode}, #{crsName}, #{acquisitionTimeStart}, #{acquisitionTimeEnd},",
            "#{timePrecision}, #{timeZone}, #{sensorPlatform}, #{provider}, #{bandCount},",
            "<choose>",
            "  <when test='bandsJson != null and bandsJson != \"\"'>",
            "    CAST(#{bandsJson,jdbcType=VARCHAR} AS jsonb),",
            "  </when>",
            "  <otherwise>NULL,</otherwise>",
            "</choose>",
            "#{widthPx}, #{heightPx}, #{pixelSizeX}, #{pixelSizeY}, #{dataType}, #{nodataValue},",
            "#{cloudCover}, #{processingLevel}, #{license}, #{usageScope}, #{uploadDescription}, #{remark},",
            "#{ext,jdbcType=VARCHAR}",

            ")",
            "ON CONFLICT (file_id) DO UPDATE SET",
            "crs_code = EXCLUDED.crs_code,",
            "crs_name = EXCLUDED.crs_name,",
            "acquisition_time_start = EXCLUDED.acquisition_time_start,",
            "acquisition_time_end = EXCLUDED.acquisition_time_end,",
            "time_precision = EXCLUDED.time_precision,",
            "time_zone = EXCLUDED.time_zone,",
            "sensor_platform = EXCLUDED.sensor_platform,",
            "provider = EXCLUDED.provider,",
            "band_count = EXCLUDED.band_count,",
            "bands_json = EXCLUDED.bands_json,",
            "width_px = EXCLUDED.width_px,",
            "height_px = EXCLUDED.height_px,",
            "pixel_size_x = EXCLUDED.pixel_size_x,",
            "pixel_size_y = EXCLUDED.pixel_size_y,",
            "data_type = EXCLUDED.data_type,",
            "nodata_value = EXCLUDED.nodata_value,",
            "cloud_cover = EXCLUDED.cloud_cover,",
            "processing_level = EXCLUDED.processing_level,",
            "\"license\" = EXCLUDED.\"license\",",
            "usage_scope = EXCLUDED.usage_scope,",
            "upload_description = EXCLUDED.upload_description,",
            "remark = EXCLUDED.remark,",
            "ext = EXCLUDED.ext",
            "</script>"
    })
    void upsertFileMetadata(FileMetadata metadata);
}
