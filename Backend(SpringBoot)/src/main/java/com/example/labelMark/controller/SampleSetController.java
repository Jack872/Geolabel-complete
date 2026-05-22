package com.example.labelMark.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.labelMark.DTO.sample.DatasetMeta;
import com.example.labelMark.DTO.sample.MetaCategory;
import com.example.labelMark.DTO.sample.MetaImage;
import com.example.labelMark.DTO.sample.MetaObject;
import com.example.labelMark.domain.*;
import com.example.labelMark.service.*;
import com.example.labelMark.utils.*;
import com.example.labelMark.vo.constant.Result;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.imageio.ImageIO;
import javax.servlet.http.HttpServletResponse;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.stream.Collectors;

/**
 * @Description
 * @Author wh
 * @Date 2025/12/16
 */
@RestController
@RequestMapping("/sampleSet")
public class SampleSetController {
    @Resource
    private SampleSetService sampleSetService;

    @Value("${sampleSet.path}")
    private String sampleSetPath;

    private Path sampleSetBaseDir() {
        return Paths.get(sampleSetPath).toAbsolutePath().normalize();
    }

    private Path normalizeStoredPathUnderSampleBase(String storedPath) {
        Path base = sampleSetBaseDir();
        Path path = Paths.get(storedPath).toAbsolutePath().normalize();
        if (!path.startsWith(base)) {
            throw new IllegalArgumentException("样本集路径越界");
        }
        return path;
    }

    private Path resolveUnderBaseDir(Path baseDir, String fileName) {
        if (fileName == null || fileName.contains("..") || fileName.matches(".*[\\\\/:*?\"<>|\\p{Cntrl}].*")) {
            throw new IllegalArgumentException("文件名非法");
        }
        Path base = baseDir.toAbsolutePath().normalize();
        Path resolved = base.resolve(fileName).normalize();
        if (!resolved.startsWith(base)) {
            throw new IllegalArgumentException("路径越界");
        }
        return resolved;
    }

    /**
     * 方法一：资源生成 (IO密集型)
     * 下载大图 -> 内存裁剪 -> 坐标转换 -> 保存切片 -> 生成中间元数据
     */
    @PostMapping("/generateMergedDataset")
    public Result generateAssets(@RequestBody Map<String, Object> params) {
        try {
            // 参数解析
            List<Integer> taskIds = (List<Integer>) params.get("taskIds");
            String datasetName = (String) params.get("datasetName");

            // 校验
            if (taskIds == null || taskIds.isEmpty()) return ResultGenerator.getFailResult("任务ID不能为空");
            if (datasetName == null || datasetName.trim().isEmpty()) return ResultGenerator.getFailResult("数据集名称不能为空");

            // 调用 Service (包含事务)
            int count = sampleSetService.createMergedDataset(taskIds, datasetName, params);

            return ResultGenerator.getSuccessResult("资源生成完毕，元数据已保存。共生成 " + count + " 张切片");

        } catch (Exception e) {
            e.printStackTrace();
            // 此时文件已删除，数据库已回滚
            return ResultGenerator.getFailResult("生成失败: " + e.getMessage());
        }
    }

    // 2. 删除样本集 (支持批量)
    @PostMapping("/delete")
    public Result delete(@RequestBody List<Integer> ids) {
        try {
            sampleSetService.deleteSampleSets(ids);
            return ResultGenerator.getSuccessResult("删除成功");
        } catch (Exception e) {
            e.printStackTrace();
            return ResultGenerator.getFailResult("删除失败: " + e.getMessage());
        }
    }

    // 3. 下载样本集
    @PostMapping("/download")
    public void download(@RequestBody Map<String, Object> params, HttpServletResponse response) {
        try {
            Integer id = Integer.parseInt(params.get("id").toString());
            String format = (String) params.getOrDefault("format", "COCO"); // COCO, YOLO, VOC

            Map<String, Object> exportOptions = new HashMap<>(params);
            String shareMode = String.valueOf(exportOptions.getOrDefault("shareMode", "relative_path"));
            if ("absolute_url".equalsIgnoreCase(shareMode) && exportOptions.get("baseUrl") == null) {
                exportOptions.put("baseUrl", ServletUriComponentsBuilder.fromCurrentContextPath().build().toUriString());
            }

            sampleSetService.downloadSampleSet(id, format, exportOptions, response);
        } catch (Exception e) {
            e.printStackTrace();
            // 注意：如果是流式下载中途报错，前端可能无法解析 JSON，最好在 Service层处理好
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
        }
    }

    @PostMapping("/export")
    public Result export(@RequestBody Map<String, Object> params) {
        try {
            Integer id = Integer.parseInt(params.get("id").toString());
            String format = (String) params.getOrDefault("format", "COCO");
            Map<String, Object> exportOptions = new HashMap<>(params);
            String shareMode = String.valueOf(exportOptions.getOrDefault("shareMode", "relative_path"));
            if ("absolute_url".equalsIgnoreCase(shareMode) && exportOptions.get("baseUrl") == null) {
                exportOptions.put("baseUrl", ServletUriComponentsBuilder.fromCurrentContextPath().build().toUriString());
            }
            return ResultGenerator.getSuccessResult(sampleSetService.exportSampleSet(id, format, exportOptions));
        } catch (Exception e) {
            e.printStackTrace();
            return ResultGenerator.getFailResult("导出失败: " + e.getMessage());
        }
    }
    // 4. 获取切片预览列表 (返回文件名 + 标注框数据)
    @GetMapping("/preview/list")
    public Result getPreviewList(@RequestParam Integer id, @RequestParam(defaultValue = "8") Integer limit) {
        try {
            SampleSet sampleSet = sampleSetService.getById(id);
            if (sampleSet == null) return ResultGenerator.getFailResult("数据集不存在");
            sampleSet = sampleSetService.getReadableSampleSet(id);

            Path slicesDir = normalizeStoredPathUnderSampleBase(sampleSet.getImageUrl());
            System.out.println("[Preview/list] slicesDir=" + slicesDir.toAbsolutePath() + ", exists=" + Files.exists(slicesDir));
            if (!Files.exists(slicesDir)) return ResultGenerator.getSuccessResult(new ArrayList<>());

            // 读取目录下的前 limit 个 jpg/png 文件（随机打乱后取前 limit 个）
            List<Path> allFiles = Files.list(slicesDir)
                    .filter(p -> p.toString().toLowerCase().endsWith(".jpg") || p.toString().toLowerCase().endsWith(".png"))
                    .collect(Collectors.toList());
            Collections.shuffle(allFiles);
            List<String> fileNames = allFiles.stream()
                    .limit(limit)
                    .map(p -> p.getFileName().toString())
                    .collect(Collectors.toList());
            System.out.println("[Preview/list] 返回文件名示例: " + (fileNames.isEmpty() ? "空" : fileNames.get(0)));

            // 读取 meta.json，构建 sliceFileName -> annotations 映射
            Map<String, List<Map<String, Object>>> annotationMap = new HashMap<>();
            Path metaFile = normalizeStoredPathUnderSampleBase(sampleSet.getLabelUrl());
            if (Files.exists(metaFile)) {
                try {
                    ObjectMapper mapper = new ObjectMapper();
                    DatasetMeta meta = mapper.readValue(metaFile.toFile(), DatasetMeta.class);
                    for (MetaImage img : meta.getImages()) {
                        for (MetaObject obj : img.getObjects()) {
                            String fn = obj.getSliceFileName();
                            annotationMap.computeIfAbsent(fn, k -> new ArrayList<>());
                            Map<String, Object> ann = new HashMap<>();
                            ann.put("bbox", obj.getBbox());           // [x, y, w, h]
                            ann.put("category", obj.getCategoryName());
                            if (obj.getSegmentation() != null && !obj.getSegmentation().isEmpty()) {
                                ann.put("segmentation", obj.getSegmentation());
                            }
                            annotationMap.get(fn).add(ann);
                        }
                    }
                } catch (Exception e) {
                    // meta 读取失败不影响图片预览
                }
            }

            // 组装返回结果
            List<Map<String, Object>> result = new ArrayList<>();
            for (String fn : fileNames) {
                Map<String, Object> item = new HashMap<>();
                item.put("fileName", fn);
                item.put("annotations", annotationMap.getOrDefault(fn, new ArrayList<>()));
                result.add(item);
            }

            return ResultGenerator.getSuccessResult(result);
        } catch (Exception e) {
            e.printStackTrace();
            return ResultGenerator.getFailResult("读取文件列表失败: " + e.getMessage());
        }
    }

    // 5. 图片流输出接口（支持 jpg/png）
    @GetMapping(value = "/image/preview")
    public void getPreviewImage(@RequestParam Integer datasetId, @RequestParam String fileName, HttpServletResponse response) {
        try {
            SampleSet sampleSet = sampleSetService.getReadableSampleSet(datasetId);
            if (sampleSet == null) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                return;
            }
            Path imagePath = resolveUnderBaseDir(normalizeStoredPathUnderSampleBase(sampleSet.getImageUrl()), fileName);
            System.out.println("[Preview] 请求图片路径: " + imagePath.toAbsolutePath());
            if (!Files.exists(imagePath)) {
                System.out.println("[Preview] 文件不存在: " + imagePath.toAbsolutePath());
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                return;
            }
            String lower = fileName.toLowerCase();
            if (lower.endsWith(".png")) {
                response.setContentType(MediaType.IMAGE_PNG_VALUE);
            } else {
                response.setContentType(MediaType.IMAGE_JPEG_VALUE);
            }
            response.setHeader("Cache-Control", "max-age=3600");
            Files.copy(imagePath, response.getOutputStream());
            response.getOutputStream().flush();
        } catch (Exception e) {
            e.printStackTrace();
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        }
    }

    // 6. Mask 图片流输出接口（从 masks/ 子目录读取）
    @GetMapping(value = "/mask/preview")
    public void getPreviewMask(@RequestParam Integer datasetId, @RequestParam String fileName, HttpServletResponse response) {
        try {
            SampleSet sampleSet = sampleSetService.getReadableSampleSet(datasetId);
            if (sampleSet == null) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                return;
            }
            // mask 存放在 slicesDir 的上级目录的 masks/ 子目录
            Path slicesDir = normalizeStoredPathUnderSampleBase(sampleSet.getImageUrl());
            Path masksDir = slicesDir.getParent().resolve("masks");
            Path maskPath = resolveUnderBaseDir(masksDir, fileName);
            if (!Files.exists(maskPath)) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                return;
            }
            response.setContentType(MediaType.IMAGE_PNG_VALUE);
            response.setHeader("Cache-Control", "max-age=3600");
            Files.copy(maskPath, response.getOutputStream());
            response.getOutputStream().flush();
        } catch (Exception e) {
            e.printStackTrace();
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        }
    }

    @GetMapping("/getProv/{id}")
    public Result getDatasetProvenance(@PathVariable Integer id) {

        try {
            Map<String, Object> result = sampleSetService.getDatasetProvenance(id);
            return ResultGenerator.getSuccessResult(result);
        } catch (Exception e) {
            return ResultGenerator.getFailResult(e.getMessage());
        }
    }

    /**
     * 获取样本集分页列表
     */
    @GetMapping("/list")
    public Result list(@RequestParam(defaultValue = "1") Integer pageNum,
                       @RequestParam(defaultValue = "10") Integer pageSize,
                       @RequestParam(required = false) String name) {
        IPage<SampleSet> result = sampleSetService.listVisibleSampleSets(pageNum, pageSize, name);

        return ResultGenerator.getSuccessResult(result);
    }
}
