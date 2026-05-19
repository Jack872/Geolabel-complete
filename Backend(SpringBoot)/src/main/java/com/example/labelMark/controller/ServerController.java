package com.example.labelMark.controller;

import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.domain.Dataset;
import com.example.labelMark.domain.Server;
import com.example.labelMark.domain.SysFile;
import com.example.labelMark.service.*;
import com.example.labelMark.utils.GeoServerRESTClient;
import com.example.labelMark.utils.ResultGenerator;
import com.example.labelMark.vo.LoginUser;
import com.example.labelMark.vo.constant.Result;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.minio.GetObjectArgs;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.*;

import io.minio.MinioClient;

/**
 * <p>
 *  前端控制器
 * </p>
 *

 */
@RestController
@RequestMapping("/server")
public class ServerController {


    @Resource
    private ServerService serverService;
    @Resource
    private SysFileService sysFileService;

    @Resource
    private GeoServerRESTClient geoServerRESTClient;
    @Resource
    private GeoServerService geoServerService;


    private static final Logger logger = LoggerFactory.getLogger(ServerController.class);

    @GetMapping("/getServers")
    public Result getServers() {
        // 获取当前登录用户
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        // 从Authentication中获取LoginUser对象
        LoginUser loginUser = (LoginUser) authentication.getPrincipal();
        // 获取用户ID
        Integer userId = loginUser.getSysUser().getUserid();

        // 用当前用户ID查询服务列表
        List<Server> servers = serverService.getServers(userId);
        return ResultGenerator.getSuccessResult(servers);
    }

    @GetMapping("/getServersBySetName")
    public Result getServersBySetName() {
        // 获取当前登录用户
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        // 从Authentication中获取LoginUser对象
        LoginUser loginUser = (LoginUser) authentication.getPrincipal();
        // 获取用户ID
        Integer userId = loginUser.getSysUser().getUserid();

        // 用当前用户ID查询按影像集分组的服务列表
        Map<String, List<String>> serversBySetName = serverService.getServersBySetName(userId);
        return ResultGenerator.getSuccessResult(serversBySetName);
    }

    @DeleteMapping("/deleteServer/{serName}")
    public Result deleteServerByName(@PathVariable String serName) {
        try {
            geoServerService.deleteStore(serName);
            int isDelete = serverService.deleteServerByName(serName);
            if (isDelete < 0) {
                return ResultGenerator.getFailResult("删除失败");
            }
            return ResultGenerator.getSuccessResult("删除成功");
        } catch (Exception e) {
            return ResultGenerator.getFailResult("删除失败" + e.getMessage());
        }
    }


    @PostMapping("/createServer")
    public Result createServer(@RequestBody Map<String, Object> map) {
        try {
            String filename = map.get("filename").toString();
            String publisher = map.get("publisher").toString();
            String publishtime = map.get("publishtime").toString();
            String serdesc = map.get("serdesc").toString();
            String sername = map.get("sername").toString();
            String seryear = map.get("seryear").toString();
            String publishUrl = map.get("publishUrl").toString();

            // 获取当前登录用户
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            // 从Authentication中获取LoginUser对象
            LoginUser loginUser = (LoginUser) authentication.getPrincipal();
            // 获取用户ID
            Integer userId = loginUser.getSysUser().getUserid();

            //创建服务
            Server server = new Server();
            server.setPublishUrl(publishUrl);
            server.setPublisher(publisher);
            server.setPublishTime(publishtime);
            server.setSerDesc(serdesc);
            server.setSerYear(seryear);
            server.setSerName(sername);
            server.setUserId(userId); // 设置用户ID

            // 获取文件的影像集名称
            SysFile sysFile = sysFileService.getFileByFileName(filename);
            if (sysFile != null && sysFile.getSetName() != null) {
                server.setSetName(sysFile.getSetName());
            }

            boolean isInserted = serverService.createServer(server);
            if (isInserted) {
//                TODO 使用fileId来唯一限定
                //            更新服务状态为已发布
                sysFileService.updateFileStatus(filename,1);
                return ResultGenerator.getSuccessResult("创建服务成功");
            } else {
                return ResultGenerator.getFailResult("创建服务失败");
            }
        }catch (Exception e){
            return ResultGenerator.getFailResult("创建失败"+ e.getMessage());
        }
    }

    /**
     * 批量发布文件到 GeoServer 并记录溯源
     * @param map
     * @return
     */
    @PostMapping("/publishSet")
    public Result publishSet(@RequestBody Map<String, Object> map) {
        try {
            // 1. 获取参数
            @SuppressWarnings("unchecked")
            List<Integer> fileIds = (List<Integer>) map.get("fileIds");
            if (fileIds == null || fileIds.isEmpty()) {
                return ResultGenerator.getFailResult("请选择要发布的文件");
            }

            // 2. 获取用户信息
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            LoginUser loginUser = (LoginUser) authentication.getPrincipal();
            Integer userId = loginUser.getSysUser().getUserid();
            String username = loginUser.getSysUser().getUsername();

            // 3. 调用 Service (事务在 Service 层生效)
            serverService.publishServices(fileIds, userId, username);

            return ResultGenerator.getSuccessResult("批量发布完成");

        } catch (Exception e) {
            logger.error("批量发布异常", e);
            // 捕获 Service 抛出的异常，返回给前端
            return ResultGenerator.getFailResult("批量发布失败: " + e.getMessage());
        }
    }

    @GetMapping("/thumbnail/{serverName}")
    public ResponseEntity<byte[]> getServerThumbnail(@PathVariable String serverName) {
        try {
            // 获取图层信息
            String layerInfo = geoServerRESTClient.getLayerInfo(serverName);
            if (layerInfo.startsWith("ERROR") || layerInfo.startsWith("GET request not worked")) {
                return ResponseEntity.notFound().build();
            }

            // 使用 Jackson 解析 JSON 响应
            ObjectMapper objectMapper = new ObjectMapper();
            JsonNode rootNode = objectMapper.readTree(layerInfo);
            String coverageHref = rootNode.path("layer").path("resource").path("href").asText();

            // 获取 coverage 详细信息
            String coverageInfo = geoServerRESTClient.getCoverageInfo(coverageHref);
            if (coverageInfo.startsWith("ERROR")) {
                return ResponseEntity.notFound().build();
            }

            // 解析 coverage 信息
            JsonNode coverageRootNode = objectMapper.readTree(coverageInfo);
            String srs = coverageRootNode.path("coverage").path("srs").asText();

            // 获取边界框信息
            JsonNode bboxNode = coverageRootNode.path("coverage").path("nativeBoundingBox");
            double minx = bboxNode.path("minx").asDouble();
            double maxx = bboxNode.path("maxx").asDouble();
            double miny = bboxNode.path("miny").asDouble();
            double maxy = bboxNode.path("maxy").asDouble();

            // 计算缩略图尺寸，保持宽高比
            double height = 300; // 缩略图高度
            double width = Math.ceil(((maxx - minx) / (maxy - miny)) * height);

            // 限制最大宽度
            if (width > 400) {
                width = 400;
                height = Math.ceil(((maxy - miny) / (maxx - minx)) * width);
            }

            String bbox = String.format("%f,%f,%f,%f", minx, miny, maxx, maxy);

            // 调用GeoServer服务获取影像
            ResponseEntity<byte[]> result = geoServerService.getGeoserverImg(
                    serverName,
                    (int) Math.round(width),
                    (int) Math.round(height),
                    bbox,
                    srs
            );

            if (result.getStatusCode().is2xxSuccessful() && result.getBody() != null) {
                // 设置响应头
                HttpHeaders headers = new HttpHeaders();
                headers.set("Content-Type", "image/jpeg");
                headers.set("Cache-Control", "max-age=3600"); // 缓存1小时

                return new ResponseEntity<>(result.getBody(), headers, HttpStatus.OK);
            } else {
                return ResponseEntity.notFound().build();
            }

        } catch (Exception e) {
            System.err.println("获取服务缩略图失败: " + e.getMessage());
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
