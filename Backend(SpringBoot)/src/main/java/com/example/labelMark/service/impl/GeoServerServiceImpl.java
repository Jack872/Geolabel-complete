package com.example.labelMark.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.domain.Server;
import com.example.labelMark.service.GeoServerService;
import com.example.labelMark.service.ServerService;
import com.example.labelMark.service.SysFileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import javax.annotation.Resource;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * @Description
 *
 * @Date 2024/5/22
 */
@Service
public class GeoServerServiceImpl implements GeoServerService {

    @Value("${geoserver.url}")
    private String geoserverUrl;
    @Value("${minio.uploaddir}")
    private String UPLOAD_DIR;
    @Value("${geoserver.username}")
    private String username;
    @Value("${geoserver.password}")
    private String password;

    private static final Logger logger = LoggerFactory.getLogger(GeoServerServiceImpl.class);

    @Resource
    @Lazy
    private ServerService serverService;
    private RestTemplate restTemplate;

    public GeoServerServiceImpl(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    @Override
    public String getCoverageInfo(String mapServer) {
        Server server = serverService.getOne(new QueryWrapper<Server>().eq("ser_name", mapServer));
        if (server == null) {
            throw new IllegalStateException("未找到对应服务记录: " + mapServer);
        }

        String coverageName = null;
        String publishUrl = server.getPublishUrl();
        if (publishUrl != null && !publishUrl.trim().isEmpty()) {
            String normalized = publishUrl.trim();
            int idx = normalized.lastIndexOf('/');
            if (idx >= 0 && idx < normalized.length() - 1) {
                coverageName = normalized.substring(idx + 1).replace(".json", "").trim();
            }
        }

        if (coverageName == null || coverageName.isEmpty()) {
            coverageName = mapServer + "_" + server.getSetName() + "_" +
                    server.getSerYear()
                            .replaceAll("[:.]", "")
                            .replace("T", "_");
        }

        String url = UriComponentsBuilder.fromHttpUrl(geoserverUrl)
                .pathSegment("rest", "workspaces", "LUU", "coveragestores",
                        mapServer, "coverages", coverageName + ".json")
                .toUriString();

        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(username, password);
        HttpEntity<Void> entity = new HttpEntity<>(headers);

        ResponseEntity<String> response =
                restTemplate.exchange(url, HttpMethod.GET, entity, String.class);

        return response.getBody();
    }

    @Override
    public ResponseEntity<byte[]> getGeoserverImg(String layerName, int width, int height, String bbox, String srs) {
        try {
            String url = UriComponentsBuilder.fromHttpUrl(geoserverUrl)
                    .pathSegment("LUU", "wms")
                    .toUriString();

            Map<String, String> params = new HashMap<>();
            params.put("service", "WMS");
            params.put("version", "1.1.0");
            params.put("request", "GetMap");
            params.put("layers", "LUU:" + layerName);
            params.put("styles", "");
            params.put("bbox", bbox);
            params.put("width", String.valueOf(width));
            params.put("height", String.valueOf(height));
            params.put("srs", srs);
            params.put("format", "image/jpeg"); // 返回JPEG格式用于缩略图
            params.put("exceptions", "application/vnd.ogc.se_inimage");

            UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(url);
            params.forEach(builder::queryParam);

            String finalUrl = builder.toUriString();
            System.out.println("Final URL: " + finalUrl); // 打印出最终的 URL

            // 添加基本身份验证头
            HttpHeaders headers = new HttpHeaders();
            String auth = username + ":" + password;
            byte[] encodedAuth = Base64.getEncoder().encode(auth.getBytes());
            String authHeader = "Basic " + new String(encodedAuth);
            headers.set("Authorization", authHeader);

            HttpEntity<String> requestEntity = new HttpEntity<>(headers);

            // 发送请求并获取响应
            ResponseEntity<byte[]> response = restTemplate.exchange(finalUrl, HttpMethod.GET, requestEntity, byte[].class);

            // 打印响应状态码和头部信息
            System.out.println("Response Status Code: " + response.getStatusCode());
            System.out.println("Response Headers: " + response.getHeaders());

            // 返回响应体
            return response;
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            e.printStackTrace();
            System.err.println("HTTP Status Code: " + e.getStatusCode());
            System.err.println("Response Body: " + e.getResponseBodyAsString());
            return ResponseEntity.status(e.getStatusCode()).body(null);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(null);
        }
    }


    /**
     * 使用本地文件，创建GeoServer数据存储
     */
    public ResponseEntity<String> createGeoServerStore(String storeName, String filePath) throws IOException, InterruptedException {
        String url = geoserverUrl + "/rest/workspaces/LUU/coveragestores";
        // Windows 下 GeoServer 要用三个斜杠
        String filePathForGeoServer = "file:///" + Paths.get(filePath).toAbsolutePath().toString().replace("\\", "/");

        String jsonBody = String.format(
                "{\n" +
                        "  \"coverageStore\": {\n" +
                        "    \"name\": \"%s\",\n" +
                        "    \"type\": \"GeoTIFF\",\n" +
                        "    \"enabled\": true,\n" +
                        "    \"workspace\": { \"name\": \"LUU\" },\n" +
                        "    \"url\": \"%s\"\n" +
                        "  }\n" +
                        "}", storeName, filePathForGeoServer);

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .header("Authorization", "Basic " + getBasicAuthToken())
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

        return ResponseEntity.status(response.statusCode()).body(response.body());
    }
    public boolean checkStoreExists(String workspace, String storeName) {
        String url = geoserverUrl + "/rest/workspaces/" + workspace + "/coveragestores/" + storeName + ".json";
        try {
            ResponseEntity<String> resp = restTemplate.exchange(url, HttpMethod.GET, createAuthEntity(), String.class);
            return resp.getStatusCode().is2xxSuccessful();
        } catch (HttpClientErrorException.NotFound e) {
            return false;
        }
    }

    /**
     * 在 GeoServer 中创建一个 “GeoTIFF – Remote” 类型的 Store
     * @param storeName  存储名（也是 coverage 名）
     * @param fileUrl  MinIO 上 .tif 的 本地 地址（需带签名或公开可读）
     */
    public ResponseEntity<String> createRemoteGeoServerStore(String storeName, String fileUrl)
            throws IOException, InterruptedException {

        String url = geoserverUrl + "/rest/workspaces/LUU/coveragestores";

        // ✅ 使用 XML 格式（GeoServer 对 XML 支持最稳定）
        String xmlBody = String.format("""
        <coverageStore>
          <name>%s</name>
          <type>GeoTIFF</type>
          <enabled>true</enabled>
          <workspace>
            <name>LUU</name>
          </workspace>
          <url>%s</url>
        </coverageStore>
        """, storeName, fileUrl);

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/xml")  // ← 改为 XML
                .header("Authorization", "Basic " + getBasicAuthToken())
                .POST(HttpRequest.BodyPublishers.ofString(xmlBody))
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        return ResponseEntity.status(response.statusCode()).body(response.body());
    }

    public boolean checkCoverageExists(String workspace, String coverageName) {
        String url = geoserverUrl + "/rest/workspaces/" + workspace + "/coverages/" + coverageName + ".json";
        try {
            ResponseEntity<String> resp = restTemplate.exchange(url, HttpMethod.GET, createAuthEntity(), String.class);
            return resp.getStatusCode().is2xxSuccessful();
        } catch (HttpClientErrorException.NotFound e) {
            return false;
        }
    }

    private HttpEntity<String> createAuthEntity() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(username, password);
        return new HttpEntity<>(headers);
    }


    @Override
    public String publish(String storeName, String seryear, String setName) {
        // 向后兼容，但不使用默认坐标系，而是返回NONE
        return publish(storeName, seryear, setName, "NONE");
    }

    @Override
    public String publish(String storeName, String seryear, String setName, String coordinateSystem) {
        // 处理无坐标系的情况
        if ("NONE".equalsIgnoreCase(coordinateSystem) || "UNKNOWN".equalsIgnoreCase(coordinateSystem)) {
            logger.info("无/未知坐标系图片，跳过GeoServer发布: {}", coordinateSystem);
            String readableTime = seryear.replaceAll("[:.]", "").replace("T", "_");
            String coverageName = storeName + "_" + setName + "_" + readableTime + "_pixel";
            return coverageName;
        }

        String readableTime = seryear.replaceAll("[:.]", "").replace("T", "_");
        String coverageName = storeName + "_" + setName + "_" + readableTime;

        // null → 自动检测模式：不指定SRS，让GeoServer从文件自动检测
        boolean autoDetect = (coordinateSystem == null || coordinateSystem.trim().isEmpty());

        logger.info("发布GeoServer服务，使用坐标系: {} (自动检测: {})",
            autoDetect ? "AUTO" : coordinateSystem, autoDetect);

        String url = UriComponentsBuilder.fromHttpUrl(geoserverUrl)
                .pathSegment("rest", "workspaces", "LUU", "coveragestores", storeName, "coverages")
                .toUriString();

        // 构造 coverage 配置
        Map<String, Object> cov = new HashMap<>();
        cov.put("name", coverageName);
        cov.put("namespace", Map.of("name", "LUU"));
        cov.put("store", Map.of("name", "LUU:" + storeName, "@class", "coverageStore"));
        cov.put("title", storeName);
        cov.put("enabled", true);

        if (!autoDetect) {
            // 有明确CRS时指定SRS
            cov.put("srs", coordinateSystem);
            cov.put("requestSRS", List.of(coordinateSystem));
            cov.put("responseSRS", List.of(coordinateSystem));
        }
        // autoDetect=true时不包含srs字段，GeoServer会从TIF文件自动检测

        String effectiveCrs = coordinateSystem; // 可能为null（auto-detect模式）
        Map<String, Object> payload = Map.of("coverage", cov);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBasicAuth(username, password);

        try {
            // 1. POST 创建 coverage
            ResponseEntity<String> resp = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(payload, headers), String.class);
            logger.info("publish success -> {}", resp.getStatusCode());

            // 自动检测模式下，从GeoServer获取检测到的CRS
            if (autoDetect) {
                try {
                    effectiveCrs = getCoverageNativeCrs(coverageName);
                    logger.info("GeoServer自动检测到CRS: {}", effectiveCrs);
                } catch (Exception ex) {
                    logger.warn("获取自动检测的CRS失败: {}", ex.getMessage());
                    effectiveCrs = "EPSG:3857";
                }
            }

            // 2. ✅ 关键步骤：调用 /reset 接口强制从数据重算 Native BBox
            try {
                String resetUrl = UriComponentsBuilder.fromHttpUrl(geoserverUrl)
                        .pathSegment("rest", "workspaces", "LUU", "coveragestores", storeName, "coverages", coverageName, "reset.xml")
                        .toUriString();

                // 创建新的 headers：Content-Type 必须是 text/plain
                HttpHeaders resetHeaders = new HttpHeaders();
                resetHeaders.setBasicAuth(username, password);
                resetHeaders.setContentType(MediaType.TEXT_PLAIN); // ⚠️ 必须是 TEXT_PLAIN

                HttpEntity<String> resetEntity = new HttpEntity<>("Reset all", resetHeaders); // ⚠️ 请求体必须是 "Reset all"

                ResponseEntity<String> resetResp = restTemplate.postForEntity(resetUrl, resetEntity, String.class);
                logger.info("Successfully triggered 'Reset all' for coverage: {} -> {}", coverageName, resetResp.getStatusCode());
            } catch (Exception ex) {
                logger.warn("Failed to reset coverage bbox for: {}", coverageName, ex);
                // 可选：不抛异常，因为发布本身成功了
            }

            // 3. 启用 WMTS 和 GWC 缓存
            // 注意：前端TMS URL使用EPSG:900913网格，所以GWC gridSetName必须配置为EPSG:900913
            try {
                // 设置 GWC 的缓存策略
                String gwcUrl = UriComponentsBuilder.fromHttpUrl(geoserverUrl)
                        .pathSegment("gwc", "rest", "layers", "LUU:" + coverageName + ".xml")
                        .toUriString();

                // 前端TMS URL固定使用EPSG:900913，GWC gridSetName必须与之匹配
                String gwcGridSet = "EPSG:900913";

                String xmlContent = "<GeoServerLayer>" +
                        "<enabled>true</enabled>" +
                        "<name>LUU:" + coverageName + "</name>" +
                        "<mimeFormats><string>image/png</string><string>image/jpeg</string></mimeFormats>" +
                        "<gridSubsets><gridSubset><gridSetName>" + gwcGridSet + "</gridSetName></gridSubset></gridSubsets>" +
                        "<metaWidthHeight><int>4</int><int>4</int></metaWidthHeight>" +
                        "<expireCache>0</expireCache>" +
                        "<expireClients>0</expireClients>" +
                        "<parameterFilters/>" +
                        "<serviceConfiguration>false</serviceConfiguration>" +
                        "<mimeType>" + "image/jpeg" + "</mimeType>" +
                        "<reuseTiles>false</reuseTiles>" +
                        "<cacheBypassAllowed>true</cacheBypassAllowed>" +
                        "</GeoServerLayer>";

                HttpHeaders gwcHeaders = new HttpHeaders();
                gwcHeaders.setBasicAuth(username, password);
                gwcHeaders.setContentType(MediaType.TEXT_XML); // 设置请求头为 XML

                HttpEntity<String> gwcEntity = new HttpEntity<>(xmlContent, gwcHeaders);

                ResponseEntity<String> gwcResp = restTemplate.postForEntity(gwcUrl, gwcEntity, String.class);
                logger.info("Successfully configured GWC for layer: {} with gridSet: {} -> {}", coverageName, gwcGridSet, gwcResp.getStatusCode());
            } catch (Exception ex) {
                logger.warn("Failed to configure GWC for layer: {}", coverageName, ex);
                // 可选：不抛异常，因为发布本身成功了
            }

            return coverageName;
        } catch (HttpClientErrorException e) {
            logger.warn("publish fail: {}", e.getMessage());
            throw new IllegalStateException("图层发布失败: " + e.getMessage());
        }
    }

    /**
     * 从GeoServer查询已发布的Coverage的Native CRS
     */
    private String getCoverageNativeCrs(String coverageName) {
        String url = UriComponentsBuilder.fromHttpUrl(geoserverUrl)
                .pathSegment("rest", "workspaces", "LUU", "coverages", coverageName + ".json")
                .toUriString();

        HttpHeaders headers = new HttpHeaders();
        headers.setBasicAuth(username, password);
        HttpEntity<Void> entity = new HttpEntity<>(headers);

        ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.GET, entity, String.class);
        String body = response.getBody();
        if (body != null) {
            java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("\"srs\"\\s*:\\s*\"([^\"]+)\"").matcher(body);
            if (matcher.find()) {
                return matcher.group(1);
            }
        }
        return "EPSG:3857";
    }

    @Override
    public boolean deleteStore(String storeName) {
        String url = geoserverUrl + "/rest/workspaces/LUU/coveragestores/" + storeName + "?recurse=true";
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setBasicAuth(username, password);
            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<String> resp = restTemplate.exchange(url, HttpMethod.DELETE, entity, String.class);
            logger.info("GeoServer coveragestore 删除成功: {}, status={}", storeName, resp.getStatusCode());
            return resp.getStatusCode().is2xxSuccessful();
        } catch (HttpClientErrorException.NotFound e) {
            logger.warn("GeoServer coveragestore 不存在，跳过: {}", storeName);
            return true;
        } catch (Exception e) {
            logger.error("GeoServer coveragestore 删除失败: {}", storeName, e);
            return false;
        }
    }

    private String getBasicAuthToken() {
        String auth = username + ":" + password;
        return Base64.getEncoder().encodeToString(auth.getBytes());
    }

}
