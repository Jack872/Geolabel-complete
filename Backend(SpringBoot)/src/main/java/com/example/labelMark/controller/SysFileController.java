package com.example.labelMark.controller;

import cn.hutool.core.util.ObjectUtil;
import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.BasicAWSCredentials;
import com.amazonaws.client.builder.AwsClientBuilder;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.s3.model.*;
import com.example.labelMark.DTO.MergeMultipartRequest;
import com.example.labelMark.DTO.prov.ProvEntityRef;
import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.domain.Dataset;
import com.example.labelMark.domain.SysFile;
import com.example.labelMark.service.DatasetService;
import com.example.labelMark.service.ProvenanceService;
import com.example.labelMark.service.SysFileService;
import com.example.labelMark.utils.ResultGenerator;
import com.example.labelMark.vo.LoginUser;
import com.example.labelMark.vo.constant.Result;
import com.example.labelMark.vo.constant.StatusEnum;
import io.swagger.annotations.ApiOperation;
import org.apache.commons.io.FileUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import java.io.*;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;


/**
 * <p>
 * 前端控制器
 * </p>
 */
@RestController
@RequestMapping("/files")
public class SysFileController {

    @Resource
    private SysFileService sysfileService;

    @Resource
    public DatasetService datasetService;
    @Resource
    public MinioConfig minioConfig;

    @Resource
    private ProvenanceService provenanceService;
    private AmazonS3 s3;


    @PostConstruct
    public void init() {
        this.s3 = AmazonS3ClientBuilder.standard()
                .withEndpointConfiguration(new AwsClientBuilder.EndpointConfiguration(
                        minioConfig.getEndpoint(), "us-east-1"))
                .withPathStyleAccessEnabled(true)
                .withCredentials(new AWSStaticCredentialsProvider(
                        new BasicAWSCredentials(minioConfig.getAccessKey(), minioConfig.getSecretKey())))
                .build();
    }
    /* 初始化分片上传 */
    @GetMapping("/initMultipart")
    public String initMultipart(@RequestParam String filename) {
        if (!s3.doesBucketExistV2(minioConfig.getBucketName())) {
            s3.createBucket(minioConfig.getBucketName());
        }
        InitiateMultipartUploadRequest request = new InitiateMultipartUploadRequest(minioConfig.getBucketName(), filename);
        InitiateMultipartUploadResult result = s3.initiateMultipartUpload(request);
        return result.getUploadId();
    }

    @PostMapping("/uploadChunk")
    public String uploadChunk(
            @RequestParam String filename,
            @RequestParam String uploadId,
            @RequestParam int partNumber,
            @RequestBody byte[] chunkData) { // 接收分片二进制

        try (InputStream is = new ByteArrayInputStream(chunkData)) {
            UploadPartRequest request = new UploadPartRequest()
                    .withBucketName(minioConfig.getBucketName())
                    .withKey(filename)
                    .withUploadId(uploadId)
                    .withPartNumber(partNumber)
                    .withInputStream(is)
                    .withPartSize(chunkData.length);

            UploadPartResult result = s3.uploadPart(request);
            return result.getETag(); // 返回 ETag 供 complete 使用
        } catch (Exception e) {
            e.printStackTrace();
            return "Upload failed";
        }
    }

    /**
     * minio合并文件后数据入库
     * @param data
     * @return
     */
    @PostMapping("/mergeMultipart")
    public ResponseEntity<?> mergeMultipart(@RequestBody MergeMultipartRequest data) {
        try {
            // 1. 校验必填参数
            if (data.getFileName() == null || data.getFileName().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "文件名不能为空"));
            }
            if (data.getUploadId() == null || data.getUploadId().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "UploadId 不能为空"));
            }
            if (data.getPartETags() == null || data.getPartETags().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "分块信息不能为空"));
            }
            if (data.getDatasetId() == null ) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "数据集ID不能为空"));
            }

            // 2. 构造 PartETag 列表
            List<PartETag> awsPartETags = data.getPartETags().stream()
                    .map(dto -> new PartETag(dto.getPartNumber(), dto.getEtag()))
                    .collect(Collectors.toList());

            // 3. 完成分块上传
            CompleteMultipartUploadRequest compRequest =
                    new CompleteMultipartUploadRequest(
                            minioConfig.getBucketName(),
                            data.getFileName(),
                            data.getUploadId(),
                            awsPartETags
                    );

            CompleteMultipartUploadResult result = s3.completeMultipartUpload(compRequest);

            // 4. 验证文件是否存在
            boolean exists = s3.doesObjectExist(minioConfig.getBucketName(), data.getFileName());
            if (!exists) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(Map.of("success", false, "message", "文件合并失败：MinIO 中未生成完整文件"));
            }

            // 4. 准备基础数据
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            LoginUser loginUser = (LoginUser) authentication.getPrincipal();
            Integer userId = loginUser.getSysUser().getUserid();
            String updatetime = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));

            // 调用 Service 的事务方法 ---
            // 这样一旦 saveFileAndProvenance 内部任何地方报错，数据库都会全部回滚
            Integer fileId = sysfileService.saveFileAndProvenance(data, userId, updatetime);

            // 5. 用 file_id 重命名 MinIO 对象，避免不同用户上传同名文件造成冲突
            String originalFileName = data.getFileName();
            String newFileName = renameWithFileId(originalFileName, fileId);
            String objectKey = buildObjectKey(fileId, newFileName);
            if (!originalFileName.equals(objectKey)) {
                try {
                    CopyObjectRequest copyReq = new CopyObjectRequest(
                            minioConfig.getBucketName(), originalFileName,
                            minioConfig.getBucketName(), objectKey);
                    s3.copyObject(copyReq);
                    s3.deleteObject(minioConfig.getBucketName(), originalFileName);

                    // 更新数据库中的文件名
                    SysFile savedFile = new SysFile();
                    savedFile.setFileId(fileId);
                    savedFile.setFileName(newFileName);
                    savedFile.setOriginalFilename(originalFileName);
                    savedFile.setStorageType("minio");
                    savedFile.setBucketName(minioConfig.getBucketName());
                    savedFile.setObjectKey(objectKey);
                    sysfileService.updateById(savedFile);
                } catch (Exception e) {
                    System.err.println("MinIO 文件重命名失败: " + e.getMessage());
                }
            } else {
                SysFile savedFile = new SysFile();
                savedFile.setFileId(fileId);
                savedFile.setFileName(newFileName);
                savedFile.setOriginalFilename(originalFileName);
                savedFile.setStorageType("minio");
                savedFile.setBucketName(minioConfig.getBucketName());
                savedFile.setObjectKey(objectKey);
                sysfileService.updateById(savedFile);
            }

            // 8. 返回成功结果
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "文件合并完成",
                    "etag", result.getETag(),
                    "location", result.getLocation()
            ));

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("success", false, "message", "文件合并失败: " + e.getMessage()));
        }
    }


    @GetMapping("/getFilesData")
    @ApiOperation("")
    public Map getFilesData(Integer current,
                           Integer pageSize,
                           @RequestParam(required = false) Integer datasetId
                          )
    {
        try {
            //            无参时默认值
            if (ObjectUtil.isEmpty(current)) {
                current = 1;
            }
            if (ObjectUtil.isEmpty(pageSize)) {
                pageSize = 5;
            }
            // 获取当前登录用户ID
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            LoginUser loginUser = (LoginUser) authentication.getPrincipal();
            Integer userId = loginUser.getSysUser().getUserid();

            List<SysFile> sysfiles = sysfileService.getFilesData(current, pageSize, datasetId, userId);
            Integer total = sysfileService.countFilesData(datasetId, userId);
            Map<String, Object> map = new HashMap<>();
            map.put("code", StatusEnum.SUCCESS.getCode());
            map.put("data", sysfiles);
            map.put("total", total);
            map.put("success", true);
            return map;
        } catch (Exception e) {
            Map<String, Object> map = new HashMap<>();
            map.put("code", StatusEnum.FAIL.getCode());
            map.put("success", false);
            map.put("message", e.getMessage());
            return map;
        }
    }





    @DeleteMapping("/deleteFile/{fileName}")
    public Result deleteFile(@PathVariable String fileName) {
        // 先尝试删除 MinIO 对象（不存在也不阻断 DB 删除）
        try {
            if (s3.doesObjectExist(minioConfig.getBucketName(), fileName)) {
                s3.deleteObject(minioConfig.getBucketName(), fileName);
            }
        } catch (Exception e) {
            System.err.println("删除 MinIO 文件失败: " + fileName + ", err=" + e.getMessage());
        }
        sysfileService.deleteFile(fileName);
        return ResultGenerator.getSuccessResult();
    }

    @DeleteMapping("/deleteFileById/{fileId}")
    public Result deleteFileById(@PathVariable Integer fileId) {
        SysFile file = sysfileService.getFileById(fileId);
        if (file == null) {
            return ResultGenerator.getFailResult("影像不存在或已删除");
        }
        try {
            String objectName = file.getObjectKey() != null ? file.getObjectKey() : file.getFileName();
            if (objectName != null && s3.doesObjectExist(minioConfig.getBucketName(), objectName)) {
                s3.deleteObject(minioConfig.getBucketName(), objectName);
            }
        } catch (Exception e) {
            System.err.println("删除 MinIO 文件失败, fileId=" + fileId + ", err=" + e.getMessage());
        }

        sysfileService.deleteFileById(fileId);
        return ResultGenerator.getSuccessResult();
    }

    private String renameWithFileId(String fileName, Integer fileId) {
        if (fileName == null || fileId == null) return fileName;
        int dot = fileName.lastIndexOf('.');
        if (dot > 0) {
            return fileName.substring(0, dot) + "_" + fileId + fileName.substring(dot);
        }
        return fileName + "_" + fileId;
    }

    private String buildObjectKey(Integer fileId, String finalFileName) {
        return "imagery/original/" + fileId + "/" + finalFileName;
    }
}
