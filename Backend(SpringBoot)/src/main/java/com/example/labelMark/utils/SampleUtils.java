package com.example.labelMark.utils;

import com.example.labelMark.DTO.TDML.TdmlExportOptions;
import com.example.labelMark.DTO.TDML.TdmlDto;
import com.example.labelMark.DTO.sample.DatasetMeta;
import com.example.labelMark.DTO.sample.MetaCategory;
import com.example.labelMark.DTO.sample.MetaImage;
import com.example.labelMark.DTO.sample.MetaObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import lombok.Data;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.LinearRing;
import org.locationtech.jts.geom.Polygon;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.charset.StandardCharsets;
import java.net.URLEncoder;
import java.util.*;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * @Description
 * @Author wh
 * @Date 2025/12/17
 */
@Component
public class SampleUtils {
    private static final GeometryFactory GEOMETRY_FACTORY = new GeometryFactory();
    private static final double DETECTION_MIN_BBOX_SIDE = 1.0;
    private static final double DETECTION_MIN_BBOX_AREA = 4.0;

    public static void createDirectory(Path path, String message) {
        try {
            Files.createDirectories(path);
            System.out.println(message);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public static void createDirectoryIfNotExists(Path path) {
        if (Files.notExists(path)) {
            try {
                Files.createDirectories(path);
                System.out.println("Created directory: " + path.toString());
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }

    // 简单的辅助方法，用于计算多边形面积（鞋带公式），如果不重要可省略
    public static double calculateArea(List<Double> segmentation) {
        return 0.0; // 这里的具体实现可以后续补充
    }

    @Data
    public static class CropRect {
        int x, y; // 裁剪起始点（可能为负，表示需要补黑边）
        int w, h; // 逻辑裁剪宽高
        int finalW, finalH; // 最终画布宽高
    }

    public static CropRect calculateCropRect(List<Double> bbox, int maxW, int maxH, double expandRatio, boolean forceSquare) {
        double bx = bbox.get(0);
        double by = bbox.get(1);
        double bw = bbox.get(2);
        double bh = bbox.get(3);

        // 1. 外扩
        double cx = bx - (bw * expandRatio) / 2;
        double cy = by - (bh * expandRatio) / 2;
        double cw = bw * (1 + expandRatio);
        double ch = bh * (1 + expandRatio);

        // 2. 强制正方形
        if (forceSquare) {
            double side = Math.max(cw, ch);
            cx = cx - (side - cw) / 2;
            cy = cy - (side - ch) / 2;
            cw = side;
            ch = side;
        }

        CropRect rect = new CropRect();
        rect.x = (int) Math.round(cx);
        rect.y = (int) Math.round(cy);
        rect.w = (int) Math.round(cw);
        rect.h = (int) Math.round(ch);
        rect.finalW = rect.w;
        rect.finalH = rect.h;
        return rect;
    }
    /**
     * 增加 targetW, targetH 参数以支持固定尺寸缩放
     */
    public static void cropAndSave(BufferedImage source, CropRect rect, int targetW, int targetH, File output) throws IOException {
        // [修改] 创建最终大小的画布 (targetW, targetH) 而不是 rect.finalW
        BufferedImage canvas = new BufferedImage(targetW, targetH, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = canvas.createGraphics();

        // 填充黑色背景
        g.setColor(Color.BLACK);
        g.fillRect(0, 0, targetW, targetH);

        // [新增] 开启高质量缩放算法 (防止图片锯齿)
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);

        // 计算源图的交集区域
        int srcX = Math.max(0, rect.x);
        int srcY = Math.max(0, rect.y);
        int srcRight = Math.min(source.getWidth(), rect.x + rect.w);
        int srcBottom = Math.min(source.getHeight(), rect.y + rect.h);

        // 有效的源图读取宽高
        int srcValidW = srcRight - srcX;
        int srcValidH = srcBottom - srcY;

        if (srcValidW > 0 && srcValidH > 0) {
            // [新增] 计算缩放比例 (目标尺寸 / 逻辑尺寸)
            double scaleX = (double) targetW / rect.w;
            double scaleY = (double) targetH / rect.h;

            // [修改] 计算绘制位置
            // 目标X = (有效源X - 逻辑起点X) * 缩放比
            int dstX = (int) ((srcX - rect.x) * scaleX);
            int dstY = (int) ((srcY - rect.y) * scaleY);
            // 目标宽高也要缩放
            int dstW = (int) (srcValidW * scaleX);
            int dstH = (int) (srcValidH * scaleY);

            BufferedImage subImage = source.getSubimage(srcX, srcY, srcValidW, srcValidH);

            // [修改] drawImage 使用缩放后的坐标和尺寸
            g.drawImage(subImage, dstX, dstY, dstW, dstH, null);
        }

        g.dispose();
        ImageIO.write(canvas, "jpg", output);
    }


    /**
     *  增加 scale 参数
     */
    public static List<List<Double>> transformPoly(List<List<Double>> globalPoly, int cropX, int cropY, double scale) {
        List<List<Double>> local = new ArrayList<>();
        if (globalPoly == null) return local;

        for (List<Double> poly : globalPoly) {
            List<Double> newPoly = new ArrayList<>();
            for (int i = 0; i < poly.size(); i += 2) {
                // [修改] 公式：(原坐标 - 偏移) * 缩放比
                double nx = (poly.get(i) - cropX) * scale;
                double ny = (poly.get(i + 1) - cropY) * scale;
                newPoly.add(nx);
                newPoly.add(ny);
            }
            local.add(newPoly);
        }
        return local;
    }

    /**
     * 增加 scale 参数
     */
    public static List<Double> transformBbox(List<Double> globalBbox, int cropX, int cropY, double scale) {
        return Arrays.asList(
                (globalBbox.get(0) - cropX) * scale, // x
                (globalBbox.get(1) - cropY) * scale, // y
                globalBbox.get(2) * scale,           // w
                globalBbox.get(3) * scale            // h
        );
    }

    public static List<Double> normalizeBbox(Object rawBbox) {
        if (rawBbox instanceof List<?>) {
            List<Double> bbox = new ArrayList<>();
            for (Object value : (List<?>) rawBbox) {
                if (value instanceof Number) {
                    bbox.add(((Number) value).doubleValue());
                }
            }
            return bbox;
        }
        if (rawBbox instanceof double[]) {
            double[] values = (double[]) rawBbox;
            List<Double> bbox = new ArrayList<>();
            for (double value : values) {
                bbox.add(value);
            }
            return bbox;
        }
        if (rawBbox instanceof int[]) {
            int[] values = (int[]) rawBbox;
            List<Double> bbox = new ArrayList<>();
            for (int value : values) {
                bbox.add((double) value);
            }
            return bbox;
        }
        if (rawBbox instanceof Number[]) {
            List<Double> bbox = new ArrayList<>();
            for (Number value : (Number[]) rawBbox) {
                if (value != null) {
                    bbox.add(value.doubleValue());
                }
            }
            return bbox;
        }
        return Collections.emptyList();
    }

    public static void createDirs(Path... paths) throws IOException {
        for (Path p : paths) {
            if (!Files.exists(p)) Files.createDirectories(p);
        }
    }

    /**
    * 针对微小目标的【固定窗口裁剪】计算
     * 直接以物体为中心，切出一个 fixedSize * fixedSize 的区域
     * 优点：分辨率无损失，背景信息丰富
     */
    public static CropRect calculateFixedWindowRect(List<Double> bbox, int imgW, int imgH, int fixedSize) {
        double bx = bbox.get(0);
        double by = bbox.get(1);
        double bw = bbox.get(2);
        double bh = bbox.get(3);

        // 计算中心点
        double centerX = bx + bw / 2.0;
        double centerY = by + bh / 2.0;

        // 直接以中心点向四周扩散 fixedSize/2
        // 这样切出来的图，物理尺寸就是 fixedSize (例如 256)
        int x = (int) Math.round(centerX - fixedSize / 2.0);
        int y = (int) Math.round(centerY - fixedSize / 2.0);

        CropRect rect = new CropRect();
        rect.x = x;
        rect.y = y;
        rect.w = fixedSize; // 逻辑宽 = 物理宽
        rect.h = fixedSize; // 逻辑高 = 物理高
        return rect;
    }
    // --- 辅助方法：生成 YOLO 格式 ---
    public static void generateYoloLabels(DatasetMeta meta, Path outputDir) throws IOException {
        // YOLO 格式: class x_center y_center width height (归一化)
        // 一个图片对应一个 txt

        // 1. 先按图片文件名归组
        Map<String, List<MetaObject>> map = new HashMap<>();
        Map<Integer, Integer> categoryIdMap = new HashMap<>(); // 映射 categoryId 到 0,1,2...

        // 建立类别映射 (YOLO类别必须从0开始)
        int clsIdx = 0;
        List<String> classesNames = new ArrayList<>();
        for (MetaCategory cat : meta.getCategories()) {
            categoryIdMap.put(cat.getId(), clsIdx++);
            classesNames.add(cat.getName());
        }
        // 写 classes.txt
        Files.write(outputDir.resolve("classes.txt"), classesNames);

        for (MetaImage img : meta.getImages()) {
            for (MetaObject obj : img.getObjects()) {
                map.computeIfAbsent(obj.getSliceFileName(), k -> new ArrayList<>()).add(obj);
            }
        }

        for (Map.Entry<String, List<MetaObject>> entry : map.entrySet()) {
            String fileName = entry.getKey();
            List<MetaObject> objects = entry.getValue();
            if (objects.isEmpty()) continue;

            // 假设切片是正方形且已知尺寸，或者从第一个 obj 取 width/height
            // 注意：metaObject 里存了 width/height
            int imgW = objects.get(0).getWidth();
            int imgH = objects.get(0).getHeight();

            List<String> lines = new ArrayList<>();
            for (MetaObject obj : objects) {
                int cls = categoryIdMap.getOrDefault(obj.getCategoryId(), 0);
                List<Double> bbox = obj.getBbox(); // [x, y, w, h]

                // 转 YOLO 中心点格式并归一化
                double dw = 1.0 / imgW;
                double dh = 1.0 / imgH;
                double x = (bbox.get(0) + bbox.get(2) / 2.0) * dw;
                double y = (bbox.get(1) + bbox.get(3) / 2.0) * dh;
                double w = bbox.get(2) * dw;
                double h = bbox.get(3) * dh;

                lines.add(String.format("%d %.6f %.6f %.6f %.6f", cls, x, y, w, h));
            }

            String txtName = fileName.substring(0, fileName.lastIndexOf(".")) + ".txt";
            Files.write(outputDir.resolve(txtName), lines);
        }
    }

    // --- 辅助方法：生成 COCO 格式 ---
    public static void generateCocoJson(DatasetMeta meta, Path outputPath) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        Map<String, Object> coco = new LinkedHashMap<>();
        Map<String, Integer> imageIdByFileName = new LinkedHashMap<>();
        List<Map<String, Object>> images = new ArrayList<>();
        List<Map<String, Object>> annotations = new ArrayList<>();

        int nextImageId = 1;
        int nextAnnotationId = 1;
        boolean metaHasObjects = false;

        if (meta != null && meta.getImages() != null) {
            for (MetaImage image : meta.getImages()) {
                if (image.getObjects() == null) continue;
                for (MetaObject object : image.getObjects()) {
                    if (object == null || object.getSliceFileName() == null || object.getBbox() == null || object.getBbox().size() < 4) {
                        continue;
                    }
                    metaHasObjects = true;
                    String fileName = object.getSliceFileName();
                    Integer imageId = imageIdByFileName.get(fileName);
                    if (imageId == null) {
                        imageId = nextImageId++;
                        imageIdByFileName.put(fileName, imageId);

                        Map<String, Object> cocoImage = new LinkedHashMap<>();
                        cocoImage.put("id", imageId);
                        cocoImage.put("file_name", fileName);
                        cocoImage.put("width", object.getWidth());
                        cocoImage.put("height", object.getHeight());
                        images.add(cocoImage);
                    }

                    List<Double> bbox = object.getBbox();
                    double width = Math.max(0D, bbox.get(2));
                    double height = Math.max(0D, bbox.get(3));
                    if (width <= 0D || height <= 0D) {
                        continue;
                    }

                    Map<String, Object> annotation = new LinkedHashMap<>();
                    annotation.put("id", nextAnnotationId++);
                    annotation.put("image_id", imageId);
                    annotation.put("category_id", object.getCategoryId());
                    annotation.put("bbox", bbox);
                    annotation.put("area", width * height);
                    annotation.put("iscrowd", 0);
                    annotation.put("segmentation", buildCocoSegmentation(object));
                    annotations.add(annotation);
                }
            }
        }

        List<Map<String, Object>> categories = new ArrayList<>();
        if (meta != null && meta.getCategories() != null) {
            for (MetaCategory category : meta.getCategories()) {
                Map<String, Object> cocoCategory = new LinkedHashMap<>();
                cocoCategory.put("id", category.getId());
                cocoCategory.put("name", category.getName());
                cocoCategory.put("supercategory", "object");
                categories.add(cocoCategory);
            }
        }

        if (metaHasObjects && (images.isEmpty() || annotations.isEmpty() || categories.isEmpty())) {
            throw new IOException("COCO 导出失败：project_meta.json 中存在标注，但无法生成有效 images/annotations/categories");
        }

        Map<String, Object> info = new LinkedHashMap<>();
        info.put("description", "Generated by LabelMark");
        info.put("date_created", meta == null ? null : meta.getCreateTime());
        coco.put("info", info);
        coco.put("images", images);
        coco.put("annotations", annotations);
        coco.put("categories", categories);
        mapper.writeValue(outputPath.toFile(), coco);
    }

    private static List<List<Double>> buildCocoSegmentation(MetaObject object) {
        if (object.getSegmentation() != null && !object.getSegmentation().isEmpty()) {
            return object.getSegmentation();
        }

        List<Double> bbox = object.getBbox();
        double x = bbox.get(0);
        double y = bbox.get(1);
        double w = bbox.get(2);
        double h = bbox.get(3);
        List<Double> polygon = Arrays.asList(
                x, y,
                x + w, y,
                x + w, y + h,
                x, y + h
        );
        return Collections.singletonList(polygon);
    }

    /**
     * 生成 VOC 格式的 XML 标注文件
     */
    public static void generateVocLabels(DatasetMeta meta, Path outputDir) throws IOException {
        // 1. 遍历所有大图记录
        for (MetaImage bigImg : meta.getImages()) {

            // 2. 将同一个大图下的切片对象，按 sliceFileName 分组
            // 虽然目前的逻辑是一张切片一个物体，但分组逻辑兼容性更好（防止未来一张切片有多个物体）
            Map<String, List<MetaObject>> sliceMap = new HashMap<>();
            if (bigImg.getObjects() != null) {
                for (MetaObject obj : bigImg.getObjects()) {
                    sliceMap.computeIfAbsent(obj.getSliceFileName(), k -> new ArrayList<>()).add(obj);
                }
            }

            // 3. 遍历每个切片，生成 XML
            for (Map.Entry<String, List<MetaObject>> entry : sliceMap.entrySet()) {
                String sliceName = entry.getKey();
                List<MetaObject> objects = entry.getValue();

                if (objects.isEmpty()) continue;

                // 假设同一张切片尺寸一致，取第一个对象的宽高
                int width = objects.get(0).getWidth();
                int height = objects.get(0).getHeight();

                StringBuilder xml = new StringBuilder();
                xml.append("<?xml version=\"1.0\" ?>\n");
                xml.append("<annotation>\n");
                xml.append("  <folder>images</folder>\n");
                xml.append("  <filename>").append(sliceName).append("</filename>\n");
                xml.append("  <path>").append(sliceName).append("</path>\n");
                xml.append("  <source>\n");
                xml.append("    <database>Unknown</database>\n");
                xml.append("  </source>\n");
                xml.append("  <size>\n");
                xml.append("    <width>").append(width).append("</width>\n");
                xml.append("    <height>").append(height).append("</height>\n");
                xml.append("    <depth>3</depth>\n"); // 默认 RGB
                xml.append("  </size>\n");
                xml.append("  <segmented>0</segmented>\n");

                for (MetaObject obj : objects) {
                    xml.append("  <object>\n");
                    xml.append("    <name>").append(obj.getCategoryName()).append("</name>\n");
                    xml.append("    <pose>Unspecified</pose>\n");
                    xml.append("    <truncated>0</truncated>\n");
                    xml.append("    <difficult>0</difficult>\n");
                    xml.append("    <bndbox>\n");

                    // 坐标转换: COCO [x, y, w, h] -> VOC [xmin, ymin, xmax, ymax]
                    List<Double> bbox = obj.getBbox();
                    if (bbox == null || bbox.size() < 4) continue;

                    double x = bbox.get(0);
                    double y = bbox.get(1);
                    double w = bbox.get(2);
                    double h = bbox.get(3);

                    double xmin = Math.max(0, x);
                    double ymin = Math.max(0, y);
                    double xmax = Math.min(width, x + w);
                    double ymax = Math.min(height, y + h);

                    xml.append("      <xmin>").append(String.format("%.2f", xmin)).append("</xmin>\n");
                    xml.append("      <ymin>").append(String.format("%.2f", ymin)).append("</ymin>\n");
                    xml.append("      <xmax>").append(String.format("%.2f", xmax)).append("</xmax>\n");
                    xml.append("      <ymax>").append(String.format("%.2f", ymax)).append("</ymax>\n");
                    xml.append("    </bndbox>\n");
                    xml.append("  </object>\n");
                }
                xml.append("</annotation>");

                // 4. 写入文件: slice_xxx.jpg -> slice_xxx.xml
                String xmlFileName = sliceName.substring(0, sliceName.lastIndexOf(".")) + ".xml";
                Path xmlFilePath = outputDir.resolve(xmlFileName);
                Files.write(xmlFilePath, xml.toString().getBytes("UTF-8"));
            }
        }
    }
    @Data
    public static class TrainingTdmlSample {
        private String sliceFileName;
        private String split;
        private String trainingType;
        private Path imageSourcePath;
        private Path maskSourcePath;
        private String imageRelativePath;
        private String maskRelativePath;
        private int width;
        private int height;
    }

    public static void generateTrainingTdmlPackage(
            Integer datasetId,
            DatasetMeta meta,
            Path sourceImagesDir,
            Path exportRoot,
            TdmlExportOptions options) throws IOException {

        TdmlExportOptions resolved = options != null ? options : new TdmlExportOptions();
        List<TrainingTdmlSample> samples = collectTrainingTdmlSamples(datasetId, meta, sourceImagesDir, resolved);
        if (samples.isEmpty()) {
            throw new IOException("未找到可导出的语义分割切片或对应 mask");
        }

        for (TrainingTdmlSample sample : samples) {
            Path imageTarget = exportRoot.resolve(sample.getImageRelativePath());
            Files.createDirectories(imageTarget.getParent());
            Files.copy(sample.getImageSourcePath(), imageTarget, StandardCopyOption.REPLACE_EXISTING);

            Path maskTarget = exportRoot.resolve(sample.getMaskRelativePath());
            Files.createDirectories(maskTarget.getParent());
            Files.copy(sample.getMaskSourcePath(), maskTarget, StandardCopyOption.REPLACE_EXISTING);
        }

        Path outputPath = exportRoot.resolve("trainingdml.json");
        generateTdmlJson(datasetId, meta, samples, outputPath, resolved);
    }

    // 兼容旧入口：当直接调用时，默认按相对路径扫描 outputPath 同级目录中的 images/masks。
    public static void generateTdmlJson(DatasetMeta meta, Path outputPath) throws IOException {
        Path exportRoot = outputPath.getParent();
        if (exportRoot == null) {
            throw new IOException("trainingdml.json 输出目录不能为空");
        }
        TdmlExportOptions options = new TdmlExportOptions();
        List<TrainingTdmlSample> samples = collectTrainingTdmlSamples(null, meta, exportRoot.resolve("images"), options);
        generateTdmlJson(null, meta, samples, outputPath, options);
    }

    private static void generateTdmlJson(
            Integer datasetId,
            DatasetMeta meta,
            List<TrainingTdmlSample> samples,
            Path outputPath,
            TdmlExportOptions options) throws IOException {

        TdmlDto.Root root = new TdmlDto.Root();
        String datasetIdValue = buildDatasetIdentifier(meta.getDatasetName());
        root.setId(datasetIdValue);
        root.setName(meta.getDatasetName());
        root.setDescription("Semantic segmentation training index exported by LabelMark. " + meta.getCreateTime());
        root.setAmountOfTrainingData(samples.size());
        root.setNumberOfClasses(meta.getCategories() == null ? 0 : meta.getCategories().size());
        root.setClassificationScheme(buildClassificationScheme(meta.getCategories()));
        root.setClasses(buildClassEntries(meta.getCategories()));
        root.setImageSize(buildImageSize(samples));
        root.setTasks(Collections.singletonList(buildSegmentationTask()));
        root.setLabeling(Collections.singletonList(buildLabeling(datasetIdValue)));

        List<TdmlDto.DataEntry> dataEntries = new ArrayList<>();
        int counter = 1;
        for (TrainingTdmlSample sample : samples) {
            TdmlDto.DataEntry entry = new TdmlDto.DataEntry();
            entry.setId(sample.getSplit() + "_" + String.format("%06d", counter++));
            entry.setDatasetId(datasetIdValue);
            entry.setTrainingType(sample.getTrainingType());
            entry.setDataURL(Collections.singletonList(buildSharedPath(
                    options,
                    datasetId,
                    sample.getImageRelativePath(),
                    true,
                    sample.getImageSourcePath().getFileName().toString()
            )));
            entry.setNumberOfLabels(1);

            TdmlDto.PixelLabel label = new TdmlDto.PixelLabel();
            label.setImageURL(Collections.singletonList(buildSharedPath(
                    options,
                    datasetId,
                    sample.getMaskRelativePath(),
                    false,
                    sample.getMaskSourcePath().getFileName().toString()
            )));
            label.setImageFormat(Collections.singletonList(detectImageFormat(sample.getMaskSourcePath().getFileName().toString())));
            entry.setLabels(Collections.singletonList(label));
            dataEntries.add(entry);
        }
        root.setData(dataEntries);

        ObjectMapper mapper = new ObjectMapper();
        mapper.enable(SerializationFeature.INDENT_OUTPUT);
        mapper.writeValue(outputPath.toFile(), root);

        if (options.isValidateSchema()) {
            validateTrainingTdmlJson(outputPath, options.getSchemaPath());
        }
    }

    private static TdmlDto.Task buildSegmentationTask() {
        TdmlDto.Task task = new TdmlDto.Task();
        task.setId("semantic-segmentation-task");
        task.setDescription("Semantic segmentation training task over image tiles with raster mask labels.");
        task.setTaskType("Semantic Segmentation");
        return task;
    }

    private static TdmlDto.Labeling buildLabeling(String datasetId) {
        TdmlDto.Labeling labeling = new TdmlDto.Labeling();
        labeling.setId("labeling-001");

        TdmlDto.Scope scope = new TdmlDto.Scope();
        TdmlDto.ScopeDescription scopeDescription = new TdmlDto.ScopeDescription();
        scopeDescription.setDataset(datasetId);
        scope.setLevelDescription(Collections.singletonList(scopeDescription));
        labeling.setScope(scope);

        TdmlDto.Procedure procedure = new TdmlDto.Procedure();
        procedure.setId("procedure-001");
        procedure.setMethods(Collections.singletonList("manual"));
        procedure.setTools(Collections.singletonList("internal-labeling-platform"));
        labeling.setProcedure(procedure);
        return labeling;
    }

    private static List<TdmlDto.ClassEntry> buildClassEntries(List<MetaCategory> categories) {
        List<TdmlDto.ClassEntry> classes = new ArrayList<>();
        if (categories == null) {
            return classes;
        }
        for (MetaCategory category : categories) {
            TdmlDto.ClassEntry classEntry = new TdmlDto.ClassEntry();
            classEntry.setKey(category.getName());
            classEntry.setValue(category.getId());
            classes.add(classEntry);
        }
        return classes;
    }

    private static String buildClassificationScheme(List<MetaCategory> categories) {
        if (categories == null || categories.isEmpty()) {
            return "semantic segmentation";
        }
        if (categories.size() == 1) {
            return "binary " + categories.get(0).getName() + "/background";
        }
        return "multi-class semantic segmentation";
    }

    private static String buildImageSize(List<TrainingTdmlSample> samples) {
        if (samples.isEmpty()) {
            return "Variable";
        }
        int width = samples.get(0).getWidth();
        int height = samples.get(0).getHeight();
        for (TrainingTdmlSample sample : samples) {
            if (sample.getWidth() != width || sample.getHeight() != height) {
                return "Variable";
            }
        }
        return width + "x" + height;
    }

    private static String buildDatasetIdentifier(String datasetName) {
        if (datasetName == null || datasetName.trim().isEmpty()) {
            return "training-dataset";
        }
        String normalized = datasetName.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-|-$)", "");
        return normalized.isEmpty() ? "training-dataset" : normalized;
    }

    private static List<TrainingTdmlSample> collectTrainingTdmlSamples(
            Integer datasetId,
            DatasetMeta meta,
            Path sourceImagesDir,
            TdmlExportOptions options) throws IOException {

        Map<String, TrainingTdmlSample> sampleMap = new LinkedHashMap<>();
        for (MetaImage image : meta.getImages()) {
            for (MetaObject object : image.getObjects()) {
                String sliceFileName = object.getSliceFileName();
                if (sliceFileName == null || sliceFileName.trim().isEmpty()) {
                    continue;
                }
                TrainingTdmlSample sample = sampleMap.computeIfAbsent(sliceFileName, key -> new TrainingTdmlSample());
                sample.setSliceFileName(sliceFileName);
                if (sample.getWidth() <= 0) {
                    sample.setWidth(object.getWidth());
                }
                if (sample.getHeight() <= 0) {
                    sample.setHeight(object.getHeight());
                }
            }
        }

        List<TrainingTdmlSample> samples = new ArrayList<>();
        for (TrainingTdmlSample sample : sampleMap.values()) {
            Path imageSource = resolveImagePath(sourceImagesDir, sample.getSliceFileName());
            Path maskSource = resolveMaskPath(sourceImagesDir, sample.getSliceFileName());
            if (imageSource == null || !Files.exists(imageSource)) {
                throw new IOException("缺少切片影像文件: " + sample.getSliceFileName());
            }
            if (maskSource == null || !Files.exists(maskSource)) {
                throw new IOException("缺少切片 mask 文件: " + sample.getSliceFileName());
            }

            String split = resolveSplit(sample.getSliceFileName(), options);
            sample.setSplit(split);
            sample.setTrainingType(toTrainingType(split));
            sample.setImageSourcePath(imageSource);
            sample.setMaskSourcePath(maskSource);
            sample.setImageRelativePath(split + "/images/" + imageSource.getFileName());
            sample.setMaskRelativePath(split + "/masks/" + maskSource.getFileName());
            samples.add(sample);
        }

        samples.sort(Comparator.comparing(TrainingTdmlSample::getSplit).thenComparing(TrainingTdmlSample::getSliceFileName));
        return samples;
    }

    private static Path resolveImagePath(Path sourceImagesDir, String sliceFileName) {
        if (sourceImagesDir == null) {
            return null;
        }
        Path direct = sourceImagesDir.resolve(sliceFileName);
        if (Files.exists(direct)) {
            return direct;
        }
        Path byName = sourceImagesDir.resolve(Path.of(sliceFileName).getFileName().toString());
        return Files.exists(byName) ? byName : direct;
    }

    private static Path resolveMaskPath(Path sourceImagesDir, String sliceFileName) throws IOException {
        if (sourceImagesDir == null || sourceImagesDir.getParent() == null) {
            return null;
        }
        Path masksDir = sourceImagesDir.getParent().resolve("masks");
        if (!Files.exists(masksDir)) {
            return null;
        }

        String normalizedName = Path.of(sliceFileName).getFileName().toString();
        String baseName = stripExtension(normalizedName);
        List<String> candidates = new ArrayList<>();
        candidates.add(normalizedName);
        candidates.add(baseName + ".png");
        candidates.add(baseName + ".tif");
        candidates.add(baseName + ".tiff");
        candidates.add(baseName + ".jpg");
        candidates.add(baseName + ".jpeg");
        if (baseName.startsWith("slice_")) {
            String maskBase = "mask_" + baseName.substring("slice_".length());
            candidates.add(maskBase + ".png");
            candidates.add(maskBase + ".tif");
            candidates.add(maskBase + ".tiff");
            candidates.add(maskBase + ".jpg");
            candidates.add(maskBase + ".jpeg");
        }

        for (String candidate : candidates) {
            Path path = masksDir.resolve(candidate);
            if (Files.exists(path)) {
                return path;
            }
        }

        try (var stream = Files.list(masksDir)) {
            Optional<Path> firstMatch = stream
                    .filter(Files::isRegularFile)
                    .filter(path -> stripExtension(path.getFileName().toString()).equals(stripExtension(normalizedName))
                            || path.getFileName().toString().contains(stripExtension(normalizedName).replace("slice_", "")))
                    .findFirst();
            return firstMatch.orElse(null);
        }
    }

    private static String resolveSplit(String sliceFileName, TdmlExportOptions options) {
        String fileName = Path.of(sliceFileName).getFileName().toString();
        Map<String, String> splitMapping = options.getSplitMapping() == null ? Collections.emptyMap() : options.getSplitMapping();
        String explicit = splitMapping.get(fileName);
        if (explicit == null) {
            explicit = splitMapping.get(sliceFileName);
        }
        if (explicit != null) {
            return normalizeSplit(explicit, options.getDefaultSplit());
        }

        String lower = sliceFileName.replace('\\', '/').toLowerCase(Locale.ROOT);
        if (lower.contains("/train/") || lower.startsWith("train_")) {
            return "train";
        }
        if (lower.contains("/val/") || lower.startsWith("val_") || lower.startsWith("validation_")) {
            return "val";
        }
        if (lower.contains("/test/") || lower.startsWith("test_")) {
            return "test";
        }
        return normalizeSplit(options.getDefaultSplit(), "train");
    }

    private static String normalizeSplit(String split, String fallback) {
        String value = split == null ? fallback : split.trim().toLowerCase(Locale.ROOT);
        if ("training".equals(value)) {
            return "train";
        }
        if ("validation".equals(value)) {
            return "val";
        }
        if ("train".equals(value) || "val".equals(value) || "test".equals(value)) {
            return value;
        }
        return fallback == null ? "train" : normalizeSplit(fallback, "train");
    }

    private static String toTrainingType(String split) {
        if ("val".equals(split)) {
            return "validation";
        }
        if ("test".equals(split)) {
            return "test";
        }
        return "training";
    }

    private static String buildSharedPath(
            TdmlExportOptions options,
            Integer datasetId,
            String relativePath,
            boolean imageAsset,
            String fileName) {
        String cleanRelativePath = relativePath.replace("\\", "/");
        if ("absolute_url".equalsIgnoreCase(options.getShareMode())) {
            String baseUrl = options.getBaseUrl() == null ? "" : options.getBaseUrl().replaceAll("/+$", "");
            if (datasetId != null && !baseUrl.isEmpty()) {
                String endpoint = imageAsset ? "image/preview" : "mask/preview";
                return baseUrl + "/sampleSet/" + endpoint + "?datasetId=" + datasetId + "&fileName=" +
                        URLEncoder.encode(fileName, StandardCharsets.UTF_8);
            }
        }
        return cleanRelativePath;
    }

    private static String detectImageFormat(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".tif") || lower.endsWith(".tiff")) {
            return "image/tiff; application=geotiff";
        }
        if (lower.endsWith(".png")) {
            return "image/png";
        }
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        return "application/octet-stream";
    }

    private static String stripExtension(String fileName) {
        int index = fileName.lastIndexOf('.');
        return index >= 0 ? fileName.substring(0, index) : fileName;
    }

    private static void validateTrainingTdmlJson(Path outputPath, String schemaPath) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(outputPath.toFile());
        if (!root.hasNonNull("type") || !"AI_EOTrainingDataset".equals(root.path("type").asText())) {
            throw new IOException("trainingdml.json 校验失败: 顶层 type 必须为 AI_EOTrainingDataset");
        }
        if (!root.hasNonNull("tasks") || !root.path("tasks").isArray() || root.path("tasks").size() == 0) {
            throw new IOException("trainingdml.json 校验失败: tasks 不能为空");
        }
        if (!root.hasNonNull("data") || !root.path("data").isArray()) {
            throw new IOException("trainingdml.json 校验失败: data 必须为数组");
        }
        for (JsonNode item : root.path("data")) {
            if (!item.path("dataURL").isArray()) {
                throw new IOException("trainingdml.json 校验失败: dataURL 必须为数组");
            }
            JsonNode labels = item.path("labels");
            if (!labels.isArray() || labels.size() == 0) {
                throw new IOException("trainingdml.json 校验失败: labels 不能为空");
            }
            for (JsonNode label : labels) {
                if (!label.path("imageURL").isArray()) {
                    throw new IOException("trainingdml.json 校验失败: imageURL 必须为数组");
                }
                if (!label.path("imageFormat").isArray()) {
                    throw new IOException("trainingdml.json 校验失败: imageFormat 必须为数组");
                }
            }
        }

        if (schemaPath != null && !schemaPath.trim().isEmpty()) {
            Path path = Path.of(schemaPath);
            if (!Files.exists(path)) {
                throw new IOException("trainingdml.json 校验失败: schema 文件不存在 " + schemaPath);
            }
            try (InputStream ignored = Files.newInputStream(path)) {
                // 这里显式检查 schema 路径可读，当前实现采用本地结构校验，不改动业务输出。
            }
        }
    }

    // --- 辅助方法：递归压缩 ---
    public static void compressDir(Path sourceDir, String entryPath, ZipOutputStream zos) throws IOException {
        Files.walk(sourceDir).filter(p -> !p.equals(sourceDir)).forEach(p -> {
            String zipEntryName = entryPath + "/" + sourceDir.relativize(p).toString().replace("\\", "/");
            try {
                if (Files.isDirectory(p)) {
                    zos.putNextEntry(new ZipEntry(zipEntryName + "/"));
                    zos.closeEntry();
                } else {
                    zos.putNextEntry(new ZipEntry(zipEntryName));
                    Files.copy(p, zos);
                    zos.closeEntry();
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        });
    }

    // =========================================================================
    // 地物分类（语义分割）滑动窗口裁切工具方法
    // =========================================================================

    /**
     * 滑动窗口裁切结果：一个窗口对应一张影像切片 + 一张 Mask 切片
     */
    @Data
    public static class SlidingWindowSlice {
        /** 窗口在原图中的起始 X（列） */
        int x;
        /** 窗口在原图中的起始 Y（行） */
        int y;
        /** 窗口宽度（等于 windowSize，边缘窗口可能不足，已补黑边） */
        int windowSize;
        /** 影像切片文件名，如 slice_1_0_0.jpg */
        String imageFileName;
        /** Mask 切片文件名，如 mask_1_0_0.png */
        String maskFileName;
        /** 该窗口内包含的标注对象列表（坐标已转为窗口局部坐标） */
        List<MetaObject> objects = new ArrayList<>();
    }

    /**
     * 将多边形标注光栅化为灰度 Mask（像素值 = 类别 ID）。
     *
     * @param imgW        原图宽度（像素）
     * @param imgH        原图高度（像素）
     * @param annotations 标注列表，每项包含 segmentation（像素坐标多边形）和 categoryId
     * @return 灰度 BufferedImage，背景像素值=0，各类别像素值=categoryId
     */
    public static BufferedImage rasterizeSegmentationMask(
            int imgW, int imgH,
            List<Map<String, Object>> annotations) {

        // TYPE_BYTE_GRAY：单通道灰度图，像素值 0-255
        BufferedImage mask = new BufferedImage(imgW, imgH, BufferedImage.TYPE_BYTE_GRAY);
        Graphics2D g = mask.createGraphics();
        // 背景填充 0（黑色）
        g.setColor(new Color(0, 0, 0));
        g.fillRect(0, 0, imgW, imgH);

        for (Map<String, Object> ann : annotations) {
            List<List<Double>> segmentation = normalizeSegmentationRings(ann.get("segmentation"));
            Integer categoryId = (Integer) ann.get("categoryId");
            if (segmentation == null || segmentation.isEmpty() || categoryId == null) continue;

            // 将多边形坐标转为 Java Polygon
            for (List<Double> ring : segmentation) {
                if (ring.size() < 6) continue; // 至少3个点
                int n = ring.size() / 2;
                int[] xs = new int[n];
                int[] ys = new int[n];
                for (int i = 0; i < n; i++) {
                    xs[i] = (int) Math.round(ring.get(i * 2));
                    ys[i] = (int) Math.round(ring.get(i * 2 + 1));
                }
                // 用类别 ID 作为灰度值（确保在 0-255 范围内）
                int grayVal = Math.min(255, Math.max(1, categoryId));
                g.setColor(new Color(grayVal, grayVal, grayVal));
                g.fillPolygon(xs, ys, n);
            }
        }
        g.dispose();
        return mask;
    }

    public static List<List<Double>> normalizeSegmentationRings(Object rawSegmentation) {
        if (!(rawSegmentation instanceof List<?>)) {
            return Collections.emptyList();
        }

        List<?> rawList = (List<?>) rawSegmentation;
        if (rawList.isEmpty()) {
            return Collections.emptyList();
        }

        Object first = rawList.get(0);
        if (first instanceof Number) {
            return Collections.singletonList(toDoubleRing(rawList));
        }

        List<List<Double>> rings = new ArrayList<>();
        for (Object ring : rawList) {
            if (ring instanceof List<?>) {
                List<Double> doubleRing = toDoubleRing((List<?>) ring);
                if (!doubleRing.isEmpty()) {
                    rings.add(doubleRing);
                }
            }
        }
        return rings;
    }

    private static List<Double> toDoubleRing(List<?> values) {
        List<Double> ring = new ArrayList<>();
        for (Object value : values) {
            if (value instanceof Number) {
                ring.add(((Number) value).doubleValue());
            }
        }
        return ring;
    }

    public static List<List<Double>> clipSegmentationToRect(
            List<List<Double>> segmentation,
            double rectX,
            double rectY,
            double rectW,
            double rectH,
            double scaleX,
            double scaleY,
            int targetW,
            int targetH) {
        if (segmentation == null || segmentation.isEmpty() || rectW <= 0 || rectH <= 0) {
            return Collections.emptyList();
        }

        Geometry source = buildGeometryFromSegmentation(segmentation);
        if (source == null || source.isEmpty()) {
            return Collections.emptyList();
        }

        Geometry clipRect = buildRectangleGeometry(rectX, rectY, rectW, rectH);
        Geometry clipped;
        try {
            clipped = source.intersection(clipRect);
        } catch (Exception e) {
            Geometry fixed = source.buffer(0);
            if (fixed == null || fixed.isEmpty()) {
                return Collections.emptyList();
            }
            clipped = fixed.intersection(clipRect);
        }

        if (clipped == null || clipped.isEmpty()) {
            return Collections.emptyList();
        }
        return geometryToLocalSegmentation(clipped, rectX, rectY, scaleX, scaleY, targetW, targetH);
    }

    public static List<Double> calculateBboxFromSegmentation(List<List<Double>> segmentation) {
        if (segmentation == null || segmentation.isEmpty()) {
            return null;
        }

        double minX = Double.MAX_VALUE;
        double minY = Double.MAX_VALUE;
        double maxX = -Double.MAX_VALUE;
        double maxY = -Double.MAX_VALUE;
        boolean hasPoint = false;

        for (List<Double> ring : segmentation) {
            if (ring == null) continue;
            for (int i = 0; i + 1 < ring.size(); i += 2) {
                double x = ring.get(i);
                double y = ring.get(i + 1);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
                hasPoint = true;
            }
        }

        if (!hasPoint) {
            return null;
        }
        return Arrays.asList(minX, minY, Math.max(0D, maxX - minX), Math.max(0D, maxY - minY));
    }

    public static boolean isValidDetectionBbox(List<Double> bbox) {
        if (bbox == null || bbox.size() < 4) {
            return false;
        }
        double width = Math.max(0D, bbox.get(2));
        double height = Math.max(0D, bbox.get(3));
        return width >= DETECTION_MIN_BBOX_SIDE
                && height >= DETECTION_MIN_BBOX_SIDE
                && width * height >= DETECTION_MIN_BBOX_AREA;
    }

    public static int countSegmentationMaskPixels(List<List<Double>> segmentation, int width, int height) {
        if (segmentation == null || segmentation.isEmpty() || width <= 0 || height <= 0) {
            return 0;
        }

        BufferedImage mask = new BufferedImage(width, height, BufferedImage.TYPE_BYTE_GRAY);
        Graphics2D g = mask.createGraphics();
        g.setColor(Color.WHITE);
        for (List<Double> ring : segmentation) {
            if (ring == null || ring.size() < 6) continue;
            int pointCount = ring.size() / 2;
            int[] xs = new int[pointCount];
            int[] ys = new int[pointCount];
            for (int i = 0; i < pointCount; i++) {
                xs[i] = (int) Math.round(ring.get(i * 2));
                ys[i] = (int) Math.round(ring.get(i * 2 + 1));
            }
            g.fillPolygon(xs, ys, pointCount);
        }
        g.dispose();

        int count = 0;
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                if ((mask.getRGB(x, y) & 0xFF) > 0) {
                    count++;
                }
            }
        }
        return count;
    }

    private static Geometry buildGeometryFromSegmentation(List<List<Double>> segmentation) {
        List<Geometry> polygons = new ArrayList<>();
        for (List<Double> ring : segmentation) {
            Polygon polygon = buildPolygonFromRing(ring);
            if (polygon != null && !polygon.isEmpty()) {
                polygons.add(polygon);
            }
        }
        if (polygons.isEmpty()) {
            return null;
        }
        Geometry geometry = GEOMETRY_FACTORY.createGeometryCollection(polygons.toArray(new Geometry[0])).union();
        return geometry.isValid() ? geometry : geometry.buffer(0);
    }

    private static Polygon buildPolygonFromRing(List<Double> ring) {
        if (ring == null || ring.size() < 6) {
            return null;
        }

        int pointCount = ring.size() / 2;
        List<Coordinate> coords = new ArrayList<>();
        for (int i = 0; i < pointCount; i++) {
            coords.add(new Coordinate(ring.get(i * 2), ring.get(i * 2 + 1)));
        }
        Coordinate first = coords.get(0);
        Coordinate last = coords.get(coords.size() - 1);
        if (!first.equals2D(last)) {
            coords.add(new Coordinate(first.x, first.y));
        }
        if (coords.size() < 4) {
            return null;
        }

        try {
            LinearRing shell = GEOMETRY_FACTORY.createLinearRing(coords.toArray(new Coordinate[0]));
            Polygon polygon = GEOMETRY_FACTORY.createPolygon(shell);
            if (polygon.isValid()) {
                return polygon;
            }
            Geometry fixed = polygon.buffer(0);
            return fixed instanceof Polygon ? (Polygon) fixed : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static Geometry buildRectangleGeometry(double x, double y, double width, double height) {
        Coordinate[] coords = new Coordinate[] {
                new Coordinate(x, y),
                new Coordinate(x + width, y),
                new Coordinate(x + width, y + height),
                new Coordinate(x, y + height),
                new Coordinate(x, y)
        };
        return GEOMETRY_FACTORY.createPolygon(coords);
    }

    private static List<List<Double>> geometryToLocalSegmentation(
            Geometry geometry,
            double offsetX,
            double offsetY,
            double scaleX,
            double scaleY,
            int targetW,
            int targetH) {
        List<List<Double>> result = new ArrayList<>();
        if (geometry == null || geometry.isEmpty()) {
            return result;
        }

        for (int i = 0; i < geometry.getNumGeometries(); i++) {
            Geometry item = geometry.getGeometryN(i);
            if (!(item instanceof Polygon) || item.isEmpty() || item.getArea() <= 0) {
                continue;
            }

            Coordinate[] coords = ((Polygon) item).getExteriorRing().getCoordinates();
            if (coords.length < 4) {
                continue;
            }

            List<Double> ring = new ArrayList<>();
            for (Coordinate coord : coords) {
                double localX = clamp((coord.x - offsetX) * scaleX, 0D, targetW);
                double localY = clamp((coord.y - offsetY) * scaleY, 0D, targetH);
                ring.add(localX);
                ring.add(localY);
            }
            if (ring.size() >= 6) {
                result.add(ring);
            }
        }
        return result;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * 滑动窗口裁切：对原图和对应 Mask 同步裁切，生成训练样本对。
     *
     * @param sourceImage  原始遥感影像（BufferedImage）
     * @param maskImage    全图 Mask（与 sourceImage 等尺寸，灰度图）
     * @param taskId       任务 ID（用于命名）
     * @param windowSize   窗口大小（正方形，如 256）
     * @param stride       滑动步长（如 128，即 50% 重叠；等于 windowSize 则无重叠）
     * @param minFgRatio   兼容旧参数，当前保留规则不再使用全局前景比例
     * @param slicesDir    影像切片输出目录
     * @param masksDir     Mask 切片输出目录
     * @param annotations  标注列表（用于生成 MetaObject，坐标为原图像素坐标）
     * @param categoryMap  类别 ID -> MetaCategory 映射
     * @return 生成的切片列表（含局部坐标标注）
     */
    public static List<SlidingWindowSlice> slidingWindowCrop(
            BufferedImage sourceImage,
            BufferedImage maskImage,
            int taskId,
            int windowSize,
            int stride,
            double minFgRatio,
            Path slicesDir,
            Path masksDir,
            List<Map<String, Object>> annotations,
            Map<Integer, MetaCategory> categoryMap) throws IOException {

        List<SlidingWindowSlice> results = new ArrayList<>();
        int imgW = sourceImage.getWidth();
        int imgH = sourceImage.getHeight();
        int sliceIdx = 0;

        for (int y = 0; y < imgH; y += stride) {
            for (int x = 0; x < imgW; x += stride) {
                // 实际裁切区域（不超出图像边界）
                int actualW = Math.min(windowSize, imgW - x);
                int actualH = Math.min(windowSize, imgH - y);

                // ── 1. 裁切 Mask 窗口。是否保留由裁剪后的对象有效性决定 ───────
                BufferedImage maskWindow = new BufferedImage(windowSize, windowSize, BufferedImage.TYPE_BYTE_GRAY);
                Graphics2D mg = maskWindow.createGraphics();
                mg.setColor(Color.BLACK);
                mg.fillRect(0, 0, windowSize, windowSize);
                mg.drawImage(maskImage.getSubimage(x, y, actualW, actualH), 0, 0, null);
                mg.dispose();

                // ── 2. 裁切影像窗口（补黑边） ─────────────────────────────
                BufferedImage imgWindow = new BufferedImage(windowSize, windowSize, BufferedImage.TYPE_INT_RGB);
                Graphics2D ig = imgWindow.createGraphics();
                ig.setColor(Color.BLACK);
                ig.fillRect(0, 0, windowSize, windowSize);
                ig.drawImage(sourceImage.getSubimage(x, y, actualW, actualH), 0, 0, null);
                ig.dispose();

                // ── 3. 生成局部坐标的 MetaObject ─────────────────────────
                String imgName  = String.format("slice_%d_%d.jpg", taskId, sliceIdx);
                String maskName = String.format("mask_%d_%d.png",  taskId, sliceIdx);
                SlidingWindowSlice slice = new SlidingWindowSlice();
                slice.setX(x);
                slice.setY(y);
                slice.setWindowSize(windowSize);
                slice.setImageFileName(imgName);
                slice.setMaskFileName(maskName);

                for (Map<String, Object> ann : annotations) {
                    List<List<Double>> segmentation = normalizeSegmentationRings(ann.get("segmentation"));
                    Integer categoryId = (Integer) ann.get("categoryId");
                    String categoryName = (String) ann.get("categoryName");
                    String categoryColor = ann.get("categoryColor") != null ? ann.get("categoryColor").toString() : null;
                    if (segmentation == null || categoryId == null) continue;
                    if ((categoryColor == null || categoryColor.trim().isEmpty()) && categoryMap.get(categoryId) != null) {
                        categoryColor = categoryMap.get(categoryId).getColor();
                    }

                    List<List<Double>> localSeg = clipSegmentationToRect(
                            segmentation, x, y, windowSize, windowSize,
                            1D, 1D, windowSize, windowSize);
                    if (countSegmentationMaskPixels(localSeg, windowSize, windowSize) < 1) continue;

                    List<Double> localBbox = calculateBboxFromSegmentation(localSeg);
                    if (localBbox == null) continue;

                    MetaObject obj = new MetaObject();
                    obj.setCategoryId(categoryId);
                    obj.setCategoryName(categoryName);
                    obj.setCategoryColor(categoryColor);
                    obj.setSliceFileName(imgName);
                    obj.setWidth(windowSize);
                    obj.setHeight(windowSize);
                    obj.setBbox(localBbox);
                    obj.setSegmentation(localSeg);
                    // 存储对应的 mask 文件名（扩展字段，通过 sliceFileName 约定命名）
                    slice.getObjects().add(obj);
                }

                if (slice.getObjects().isEmpty()) {
                    sliceIdx++;
                    continue;
                }

                // ── 4. 保存文件 ───────────────────────────────────────────
                ImageIO.write(imgWindow,  "jpg", slicesDir.resolve(imgName).toFile());
                ImageIO.write(maskWindow, "png", masksDir.resolve(maskName).toFile());

                results.add(slice);
                sliceIdx++;
            }
        }
        return results;
    }

}

