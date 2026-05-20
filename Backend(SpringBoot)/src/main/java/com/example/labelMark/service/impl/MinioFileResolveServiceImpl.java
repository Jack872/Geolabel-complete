package com.example.labelMark.service.impl;

import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.domain.SysFile;
import com.example.labelMark.service.MinioFileResolveService;
import com.example.labelMark.service.SysFileService;
import io.minio.GetObjectArgs;
import io.minio.ListObjectsArgs;
import io.minio.MinioClient;
import io.minio.Result;
import io.minio.messages.Item;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.*;

@Service
public class MinioFileResolveServiceImpl implements MinioFileResolveService {

    private static final Logger log = LoggerFactory.getLogger(MinioFileResolveServiceImpl.class);

    @Resource
    private SysFileService sysFileService;
    @Resource
    private MinioClient minioClient;
    @Resource
    private MinioConfig minioConfig;

    @Override
    public File resolveToLocalFile(Integer fileId, Path targetDir) {
        SysFile file = sysFileService.getFileById(fileId);
        if (file == null) {
            throw new IllegalArgumentException("file 不存在: fileId=" + fileId);
        }
        return resolveToLocalFile(file, targetDir);
    }

    @Override
    public File resolveToLocalFile(SysFile file, Path targetDir) {
        if (file == null) {
            throw new IllegalArgumentException("file 不能为空");
        }
        try {
            Files.createDirectories(targetDir);
            String storageType = trimToNull(file.getStorageType());
            storageType = storageType == null ? "local" : storageType.toLowerCase(Locale.ROOT);
            String bucket = trimToNull(file.getBucketName());
            if (bucket == null) {
                bucket = minioConfig.getBucketName();
            }
            String objectKey = trimToNull(file.getObjectKey());
            String fallbackObjectName = trimToNull(file.getFileName());
            Path targetPath = targetDir.resolve(buildCacheFileName(file));

            log.info("[minio_resolve] fileId={}", file.getFileId());
            log.info("[minio_resolve] storageType={}", storageType);
            log.info("[minio_resolve] bucket={}", bucket);
            log.info("[minio_resolve] objectKey={}", objectKey);

            if ("minio".equals(storageType) || objectKey != null) {
                if (downloadSingleObject(bucket, buildObjectCandidates(objectKey, fallbackObjectName), targetPath)) {
                    log.info("[minio_resolve] mode=single-object");
                    log.info("[minio_resolve] localPath={}", targetPath);
                    return targetPath.toFile();
                }
                if (restoreFromLegacyChunks(bucket, objectKey, fallbackObjectName, targetPath)) {
                    log.info("[minio_resolve] mode=legacy-chunk-restore");
                    log.info("[minio_resolve] localPath={}", targetPath);
                    return targetPath.toFile();
                }
                throw new IllegalStateException("无法从 MinIO 解析源文件, fileId=" + file.getFileId());
            }

            String localPath = firstNonBlank(fallbackObjectName, file.getOriginalFilename());
            if (localPath == null) {
                throw new IllegalStateException("本地文件路径为空, fileId=" + file.getFileId());
            }
            Path sourcePath = Path.of(localPath);
            if (!Files.isRegularFile(sourcePath)) {
                throw new IllegalStateException("本地文件不存在: " + localPath);
            }
            Files.copy(sourcePath, targetPath, StandardCopyOption.REPLACE_EXISTING);
            log.info("[minio_resolve] mode=local-fallback");
            log.info("[minio_resolve] localPath={}", targetPath);
            return targetPath.toFile();
        } catch (IOException e) {
            throw new IllegalStateException("解析源文件失败, fileId=" + file.getFileId(), e);
        }
    }

    private String buildCacheFileName(SysFile file) {
        String displayName = firstNonBlank(file.getFileName(), file.getOriginalFilename(), "file_" + file.getFileId());
        int dot = displayName.lastIndexOf('.');
        String extName = dot >= 0 ? displayName.substring(dot) : "";
        return file.getFileId() + extName;
    }

    private List<String> buildObjectCandidates(String objectKey, String fileName) {
        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        if (objectKey != null) {
            candidates.add(normalizeObjectName(objectKey));
            candidates.add(new File(objectKey).getName());
        }
        if (fileName != null) {
            candidates.add(normalizeObjectName(fileName));
            candidates.add(new File(fileName).getName());
        }
        return new ArrayList<>(candidates);
    }

    private boolean downloadSingleObject(String bucket, List<String> candidates, Path targetPath) {
        for (String objectName : candidates) {
            if (objectName == null || objectName.trim().isEmpty()) {
                continue;
            }
            try (InputStream in = minioClient.getObject(
                    GetObjectArgs.builder().bucket(bucket).object(objectName).build())) {
                Files.copy(in, targetPath, StandardCopyOption.REPLACE_EXISTING);
                return true;
            } catch (Exception ignored) {
            }
        }
        return false;
    }

    private boolean restoreFromLegacyChunks(String bucket, String objectKey, String fileName, Path targetPath) {
        LinkedHashSet<String> prefixes = new LinkedHashSet<>();
        if (objectKey != null) {
            prefixes.add(normalizeObjectName(objectKey));
            prefixes.add(new File(objectKey).getName());
        }
        if (fileName != null) {
            prefixes.add(normalizeObjectName(fileName));
            prefixes.add(new File(fileName).getName());
            prefixes.add(fileName.replaceAll("(?i)\\.tiff?$", ""));
        }

        Map<Integer, String> orderedParts = new TreeMap<>();
        for (String prefix : prefixes) {
            if (prefix == null || prefix.trim().isEmpty()) {
                continue;
            }
            try {
                Iterable<Result<Item>> results = minioClient.listObjects(
                        ListObjectsArgs.builder().bucket(bucket).prefix(prefix).recursive(true).build());
                for (Result<Item> result : results) {
                    Item item = result.get();
                    Integer chunkIndex = extractChunkIndex(new File(item.objectName()).getName(), fileName);
                    if (chunkIndex != null) {
                        orderedParts.putIfAbsent(chunkIndex, item.objectName());
                    }
                }
            } catch (Exception ignored) {
            }
        }
        if (orderedParts.isEmpty()) {
            return false;
        }

        try (OutputStream out = Files.newOutputStream(targetPath)) {
            for (String objectName : orderedParts.values()) {
                try (InputStream in = minioClient.getObject(
                        GetObjectArgs.builder().bucket(bucket).object(objectName).build())) {
                    in.transferTo(out);
                }
            }
            return true;
        } catch (Exception e) {
            try {
                Files.deleteIfExists(targetPath);
            } catch (IOException ignored) {
            }
            return false;
        }
    }

    private Integer extractChunkIndex(String basename, String fileName) {
        if (basename == null || fileName == null) {
            return null;
        }
        String normalizedBase = basename.toLowerCase(Locale.ROOT);
        String normalizedName = fileName.toLowerCase(Locale.ROOT);
        String normalizedNoExt = normalizedName.replaceAll("(?i)\\.tiff?$", "");
        String[] prefixes = new String[]{
                normalizedName + ".part", normalizedNoExt + ".part",
                normalizedName + "_part_", normalizedNoExt + "_part_",
                normalizedName + ".", normalizedNoExt + "."
        };
        for (String prefix : prefixes) {
            if (!normalizedBase.startsWith(prefix)) {
                continue;
            }
            String digits = normalizedBase.substring(prefix.length()).replaceAll("[^0-9].*$", "");
            if (!digits.isEmpty()) {
                try {
                    return Integer.parseInt(digits);
                } catch (Exception ignored) {
                }
            }
        }
        return null;
    }

    private String normalizeObjectName(String value) {
        return value == null ? null : value.trim().replace('\\', '/');
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            String trimmed = trimToNull(value);
            if (trimmed != null) {
                return trimmed;
            }
        }
        return null;
    }
}
