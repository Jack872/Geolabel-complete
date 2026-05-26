package com.example.labelMark.controller;
import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.domain.Server;
import com.example.labelMark.domain.SysFile;
import com.example.labelMark.service.GeoServerService;
import com.example.labelMark.service.MinioFileResolveService;
import com.example.labelMark.service.ServerService;
import com.example.labelMark.service.SysFileService;
import com.example.labelMark.utils.CoordinateSystemUtils;
import com.example.labelMark.vo.LoginUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;

@RestController
@RequestMapping("/geoserver")
public class GeoServerController {
    private static final Logger logger = LoggerFactory.getLogger(GeoServerController.class);
    private static final DateTimeFormatter DATE_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    @Resource
    private GeoServerService geoServerService;

    @Resource
    private MinioConfig minioConfig;
    @Resource
    private ServerService serverService;
    @Resource
    private SysFileService sysFileService;
    @Resource
    private CoordinateSystemUtils coordinateSystemUtils;
    @Resource
    private MinioFileResolveService minioFileResolveService;
    @Value("${geoserver.url}")
    private String geoserverUrl;
    @Value("${minio.uploaddir}")
    private String UPLOAD_DIR;


    @GetMapping("/img")
    public ResponseEntity<byte[]> getGeoserverImg(
            @RequestParam String layerName,
            @RequestParam int width,
            @RequestParam int height,
            @RequestParam String bbox,
            @RequestParam String srs) {
        return geoServerService.getGeoserverImg(layerName, width, height, bbox, srs);
    }

    @GetMapping("/coverage/{id}")
    public String getMeta(@PathVariable Integer id) {
        return geoServerService.getCoverageInfo(id);
    }



    @PostMapping("/datastore")
    public ResponseEntity<String> createDataStore(@RequestBody Map<String, String> req)
            throws IOException, InterruptedException {
        String storeName = req.get("storeName");
        String filePath = req.get("filePath");
        return geoServerService.createGeoServerStore(storeName, filePath);
    }

    @PostMapping("/publish")
    public ResponseEntity<?> publish(@RequestBody Map<String, Object> data) {
        try {
            Integer fileId = data.get("fileId") == null ? null : Integer.valueOf(String.valueOf(data.get("fileId")));
            SysFile file = fileId == null ? null : sysFileService.getFileById(fileId);
            if (file == null) {
                String filenameParam = (String) data.get("filename");
                if (filenameParam != null && !filenameParam.trim().isEmpty()) {
                    file = sysFileService.getFileByFileName(filenameParam.trim());
                }
            }
            if (file == null) {
                throw new IllegalArgumentException("未找到待发布影像");
            }
            String filename = file.getFileName();
            String sername = filename.split("\\.")[0];
            String serdesc = (String) data.get("serdesc");
            Object yearObj = data.get("seryear");
            String seryear = yearObj != null ? yearObj.toString() : null;
            String setName = (String) data.get("setname");
            Path localPublishDir = Path.of(System.getProperty("java.io.tmpdir"), "geolabel_geoserver_publish");
            Files.createDirectories(localPublishDir);
            File resolvedFile = minioFileResolveService.resolveToLocalFile(file, localPublishDir);

            // 2. 检查 store 是否存在
            boolean storeExists = geoServerService.checkStoreExists("LUU", sername);

            if (!storeExists) {
                // 3. 如果 store 不存在，则创建 GeoServer store
                ResponseEntity<String> createResp = geoServerService.createGeoServerStore(sername, resolvedFile.getAbsolutePath());
                if (!createResp.getStatusCode().is2xxSuccessful()) {
                    throw new IllegalStateException("创建 GeoServer Store 失败: " + createResp.getBody());
                }

                // 额外验证 store 是否创建成功
                storeExists = geoServerService.checkStoreExists("LUU", sername);
                if (!storeExists) {
                    throw new IllegalStateException("CoverageStore 未创建成功，无法发布");
                }
            }

            String coverageName=sername;

            // 4.1 动态获取坐标系 - 从请求中获取或使用NONE
            String coordinateSystem = (String) data.get("coordinateSystem");
            if (coordinateSystem == null || coordinateSystem.trim().isEmpty()) {
                // 如果没有提供坐标系，标记为NONE（无坐标系）
                coordinateSystem = "NONE";
                logger.info("未提供坐标系，标记为NONE");
            }

            logger.info("使用坐标系: {}", coordinateSystem);

            // 检查是否为无坐标系
            boolean isPixelCRS = coordinateSystem.equals("NONE") || coordinateSystem.equals("UNKNOWN");

            // 4. 先判断 coverage 是否已存在
            boolean coverageExists = geoServerService.checkCoverageExists("LUU", sername);
            if (!coverageExists) {
                // 4.2 发布时传入坐标系参数
                coverageName = geoServerService.publish(sername, seryear, setName, coordinateSystem);

                // 4.3 再次确认（仅对有坐标系的图片）
                if (!isPixelCRS) {
                    coverageExists = geoServerService.checkCoverageExists("LUU", coverageName);
                    if (!coverageExists) {
                        throw new IllegalStateException("Coverage 发布失败");
                    }
                } else {
                    logger.info("无坐标系图片已处理，覆盖名称: {}", coverageName);
                }
            }

            // 4. 记录数据库
            String publishUrl = String.format(
                    "%s/rest/workspaces/LUU/coveragestores/%s/coverages/%s",
                    geoserverUrl, sername, coverageName);
//            保存发布的服务
            // 5. 获取当前登录用户ID
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            LoginUser loginUser = (LoginUser) authentication.getPrincipal();
            Integer userId = loginUser.getSysUser().getUserid();
            String username = loginUser.getSysUser().getUsername();
            Server server=new Server();
            server.setSerYear(seryear);
            server.setSerName(sername);
            server.setSerDesc(serdesc);
            server.setPublisher(username);
            server.setUserId(userId);
            server.setPublishTime(LocalDateTime.now().format(DATE_TIME_FORMATTER));
            server.setPublishUrl(publishUrl);
            server.setSetName(setName);
            serverService.createServer(server);
//            修改状态为已发布
            sysFileService.updateFileStatus(filename, 1);
            return ResponseEntity.ok(Map.of("success", true, "publishUrl", publishUrl));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("success", false, "message", "发布失败", "error", e.getMessage()));
        }
    }
}
