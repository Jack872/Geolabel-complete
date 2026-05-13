package com.example.labelMark.utils;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import org.geotools.coverage.grid.io.AbstractGridFormat;
import org.geotools.coverage.grid.io.GridCoverage2DReader;
import org.geotools.coverage.grid.io.GridFormatFinder;
import org.geotools.referencing.CRS;
import org.opengis.referencing.crs.CoordinateReferenceSystem;
import org.springframework.stereotype.Component;

@Component
public class CommUtils {
    public static String getNowDateLongStr(String pattern) {
        SimpleDateFormat dateFormat = new SimpleDateFormat(pattern);
        return dateFormat.format(new Date());
    }
    public String getTiffSRS(String tifPath) {
        try {
            File file = new File(tifPath);
            AbstractGridFormat format = GridFormatFinder.findFormat(file);
            GridCoverage2DReader reader = format.getReader(file);
            if (reader == null) {
                return "UNKNOWN";
            }
            CoordinateReferenceSystem crs = reader.getCoordinateReferenceSystem();

            // 返回 EPSG 代码，比如 "EPSG:3301"
            String epsg = CRS.toSRS(crs);
            if (epsg != null) {
                return epsg;
            } else {
                // 无法识别时，返回 WKT 或默认
                return "UNKNOWN";
            }
        } catch (Exception e) {
            e.printStackTrace();
            return "UNKNOWN";
        }
    }
}
