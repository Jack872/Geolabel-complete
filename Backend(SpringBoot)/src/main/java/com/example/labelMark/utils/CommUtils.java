package com.example.labelMark.utils;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.geotools.coverage.grid.io.AbstractGridFormat;
import org.geotools.coverage.grid.io.GridCoverage2DReader;
import org.geotools.coverage.grid.io.GridFormatFinder;
import org.geotools.referencing.CRS;
import org.opengis.referencing.crs.CoordinateReferenceSystem;
import org.opengis.referencing.ReferenceIdentifier;
import org.springframework.stereotype.Component;

@Component
public class CommUtils {
    private static final Pattern EPSG_AUTHORITY_PATTERN =
            Pattern.compile("AUTHORITY\\s*\\[\\s*\"EPSG\"\\s*,\\s*\"?(\\d+)\"?\\s*\\]", Pattern.CASE_INSENSITIVE);
    private static final Pattern EPSG_IN_EXCEPTION_PATTERN =
            Pattern.compile("EPSG:(\\d+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern GEOKEY_3072_PATTERN =
            Pattern.compile("Key\\s*=\\s*3072\\s*,\\s*Value\\s*=\\s*(\\d+)", Pattern.CASE_INSENSITIVE);

    public static String getNowDateLongStr(String pattern) {
        SimpleDateFormat dateFormat = new SimpleDateFormat(pattern);
        return dateFormat.format(new Date());
    }

    private String resolveCrsCode(CoordinateReferenceSystem crs) {
        if (crs == null) return "UNKNOWN";

        try {
            Integer epsg = CRS.lookupEpsgCode(crs, true);
            if (epsg != null) return "EPSG:" + epsg;
        } catch (Exception ignored) {
        }

        try {
            String srs = CRS.toSRS(crs, true);
            if (srs != null && !srs.trim().isEmpty()) {
                if (srs.toUpperCase().startsWith("EPSG:")) return srs.toUpperCase();
                if (srs.matches("\\d+")) return "EPSG:" + srs;
            }
        } catch (Exception ignored) {
        }

        try {
            Set<ReferenceIdentifier> identifiers = crs.getIdentifiers();
            if (identifiers != null) {
                for (ReferenceIdentifier id : identifiers) {
                    String codeSpace = id.getCodeSpace();
                    String code = id.getCode();
                    if (codeSpace != null && "EPSG".equalsIgnoreCase(codeSpace) && code != null && !code.isEmpty()) {
                        return "EPSG:" + code;
                    }
                    if (code != null && code.toUpperCase().startsWith("EPSG:")) {
                        return code.toUpperCase();
                    }
                }
            }
        } catch (Exception ignored) {
        }

        try {
            ReferenceIdentifier name = crs.getName();
            if (name != null && name.getCode() != null) {
                String code = name.getCode();
                if (code.toUpperCase().startsWith("EPSG:")) return code.toUpperCase();
            }
        } catch (Exception ignored) {
        }

        try {
            String wkt = crs.toWKT();
            Matcher matcher = EPSG_AUTHORITY_PATTERN.matcher(wkt);
            if (matcher.find()) {
                return "EPSG:" + matcher.group(1);
            }
        } catch (Exception ignored) {
        }

        return "UNKNOWN";
    }

    public String getTiffSRS(String tifPath) {
        try {
            File file = new File(tifPath);
            if (!file.exists() || !file.isFile()) {
                return "UNKNOWN";
            }
            AbstractGridFormat format = GridFormatFinder.findFormat(file);
            if (format == null) {
                return "UNKNOWN";
            }
            GridCoverage2DReader reader = format.getReader(file);
            CoordinateReferenceSystem crs = reader.getCoordinateReferenceSystem();
            if (crs == null) {
                return "UNKNOWN";
            }
            return resolveCrsCode(crs);
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "" : e.getMessage();
            Matcher m1 = EPSG_IN_EXCEPTION_PATTERN.matcher(msg);
            if (m1.find()) {
                return "EPSG:" + m1.group(1);
            }
            Matcher m2 = GEOKEY_3072_PATTERN.matcher(msg);
            if (m2.find()) {
                return "EPSG:" + m2.group(1);
            }
            return "UNKNOWN";
        }
    }
}
