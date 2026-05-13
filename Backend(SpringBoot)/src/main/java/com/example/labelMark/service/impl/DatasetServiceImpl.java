package com.example.labelMark.service.impl;

import com.example.labelMark.domain.Dataset;
import com.example.labelMark.domain.DatasetStore;
import com.example.labelMark.domain.SampleImg;
import com.example.labelMark.domain.Server;
import com.example.labelMark.domain.SysFile;
import com.example.labelMark.domain.Task;
import com.example.labelMark.mapper.DatasetMapper;
import com.example.labelMark.mapper.DatasetStoreMapper;
import com.example.labelMark.mapper.SampleImgMapper;
import com.example.labelMark.mapper.TaskMapper;
import com.amazonaws.services.s3.AmazonS3;
import com.example.labelMark.config.MinioConfig;
import com.example.labelMark.service.DatasetService;
import com.example.labelMark.service.DatasetStoreService;
import com.example.labelMark.service.GeoServerService;
import com.example.labelMark.service.ServerService;
import com.example.labelMark.service.SysFileService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.*;
import java.util.stream.Collectors;

/**
 * <p>
 * 鏁版嵁闆嗘湇鍔″疄鐜扮被
 * </p>
 *
 *
 * @since 2024-05-08
 */
@Service
public class DatasetServiceImpl extends ServiceImpl<DatasetMapper, Dataset> implements DatasetService {

    private static final Logger logger = LoggerFactory.getLogger(DatasetServiceImpl.class);

    @Resource
    private DatasetMapper datasetMapper;

    @Resource
    private DatasetStoreMapper datasetStoreMapper;

    @Resource
    private TaskMapper taskMapper;

    @Resource
    private SampleImgMapper sampleImgMapper;

    @Resource
    private DatasetStoreService datasetStoreService;

    @Resource
    @Lazy
    private ServerService serverService;

    @Resource
    private GeoServerService geoServerService;

    @Resource
    @Lazy
    private SysFileService sysFileService;

    @Resource
    private AmazonS3 amazonS3;

    @Resource
    private MinioConfig minioConfig;

    @Override
    public Integer createDataset(Dataset dataset) {
        datasetMapper.createDataset(dataset);
        return dataset.getId();
    }

    @Override
    public List<Dataset> findDatasetBySampleId(String sampleId) {
        return datasetMapper.findDatasetBySampleId(sampleId);
    }

    @Override
    public List<Dataset> findDatasetByUserId(int userId) {
        return datasetMapper.findDatasetByUserId(userId);
    }

    @Override
    public Integer publishSharedDataset(List<String> sampleIds, String name, String setDess, String cont, String email, Integer goal) {
        if (sampleIds == null || sampleIds.isEmpty()) {
            return null;
        }

        // 灏嗘牱鏈琁D鍒楄〃杞崲涓烘暣鏁板垪琛?
        List<Integer> sampleIdInts = sampleIds.stream()
                .map(Integer::parseInt)
                .collect(Collectors.toList());

        // 鑾峰彇绗竴鏉¤褰曠殑浠诲姟淇℃伅
        DatasetStore firstDatasetStore = datasetStoreMapper.selectById(sampleIdInts.get(0));
        if (firstDatasetStore == null) {
            return null;
        }

        // 鑾峰彇浠诲姟淇℃伅
        Task task = taskMapper.selectById(firstDatasetStore.getTaskId());
        if (task == null) {
            return null;
        }

        // 璁＄畻鏍锋湰鏁伴噺
        int totalSamples = 0;
        for (Integer sampleId : sampleIdInts) {
            int count = datasetStoreService.getTotalImgNumBySampleId(sampleId);
            totalSamples += count;
        }

        // 鑾峰彇鎵€鏈夋牱鏈殑绫诲埆
        Set<String> typeNames = new HashSet<>();
        for (Integer sampleId : sampleIdInts) {
            List<Map<String, Object>> types = sampleImgMapper.findTypeNamesBySampleId(sampleId);
            for (Map<String, Object> type : types) {
                String typeName = (String) type.get("type_name");
                if (typeName != null) {
                    typeNames.add(typeName);
                }
            }
        }

        // 鑾峰彇澶氫釜鏍锋湰鐨勫浘鍍忎綔涓虹缉鐣ュ浘锛岀敤閫楀彿鍒嗛殧
        List<String> thumbUrls = new ArrayList<>();
        for (Integer sampleId : sampleIdInts) {
            List<SampleImg> sampleImgs = sampleImgMapper.findImgSrcBySampleId(sampleId, 1, 0);
            if (!sampleImgs.isEmpty()) {
                // 鑾峰彇瀵瑰簲鐨勪换鍔D
                DatasetStore datasetStore = datasetStoreMapper.selectById(sampleId);
                if (datasetStore != null) {
                    String imgSrc = sampleImgs.get(0).getImgSrc();
                    String thumbPath;

                    System.out.println("鍘熷imgSrc: " + imgSrc);
                    System.out.println("taskId: " + datasetStore.getTaskId());

                    // 妫€鏌mgSrc鏄惁宸茬粡鏄畬鏁磋矾寰?
                    if (imgSrc.startsWith("/home/change/labelcode/")) {
                        // 濡傛灉宸茬粡鏄畬鏁磋矾寰勶紝鐩存帴浣跨敤
                        thumbPath = imgSrc;
                        System.out.println("浣跨敤瀹屾暣璺緞: " + thumbPath);
                    } else {
                        // 濡傛灉鏄浉瀵硅矾寰勬垨鏂囦欢鍚嶏紝鏋勫缓瀹屾暣璺緞
                        // 鎻愬彇鏂囦欢鍚嶏紙鍘绘帀鍙兘鐨勮矾寰勫墠缂€锛?
                        String fileName = imgSrc;
                        if (imgSrc.contains("/")) {
                            fileName = imgSrc.substring(imgSrc.lastIndexOf("/") + 1);
                        }
                        thumbPath = "/home/change/labelcode/labelMark/src/main/java/com/example/labelMark/resource/public/dataset_temp/mark_" +
                                   datasetStore.getTaskId() + "/mark_" + datasetStore.getTaskId() + "_" + fileName;
                        System.out.println("鏋勫缓璺緞: " + thumbPath);
                    }
                    thumbUrls.add(thumbPath);
                }
            }
        }
        String thumbUrl = String.join(",", thumbUrls);

        // 鍒涘缓鏁版嵁闆嗗璞?
        Dataset dataset = new Dataset();
        dataset.setName(name);
        dataset.setDescription(setDess);
        dataset.setThumbUrl(thumbUrl);
        dataset.setSampleNum(totalSamples);
        dataset.setContact(cont);
        dataset.setEmail(email);
        dataset.setSorts(String.join(",", typeNames));
        dataset.setUserId(task.getUserId());
        dataset.setTaskType(task.getTaskType());
        dataset.setScore(goal);
        dataset.setSetType("service");

        // 鍒涘缓鏁版嵁闆?
        datasetMapper.createDataset(dataset);

        // 鏇存柊鎵€鏈夋牱鏈负鍏紑鐘舵€?
        for (Integer sampleId : sampleIdInts) {
            datasetStoreService.updateDatasetStatusBySampleId(1, sampleId);
        }

        return dataset.getId();
    }

    @Override
    public Dataset findDatasetByContainedSampleStoreId(Integer sampleStoreId) {
        if (sampleStoreId == null) {
            return null;
        }
        String idStr = String.valueOf(sampleStoreId);
        QueryWrapper<Dataset> queryWrapper = new QueryWrapper<>();
        // 绮剧‘鍖归厤鍗曚釜ID鎴朓D鍦ㄩ€楀彿鍒嗛殧鍒楄〃涓殑鎯呭喌
        queryWrapper.and(wrapper -> wrapper
                .eq("sample_id", idStr) // 瀹屽叏鍖归厤鍗曚釜ID
                .or().like("sample_id", idStr + ",%") // ID鍦ㄥ垪琛ㄥ紑澶?
                .or().like("sample_id", "%," + idStr + ",%") // ID鍦ㄥ垪琛ㄤ腑闂?
                .or().like("sample_id", "%," + idStr) // ID鍦ㄥ垪琛ㄦ湯灏?
        );
        List<Dataset> datasets = list(queryWrapper);
        if (datasets != null && !datasets.isEmpty()) {
            // 濡傛灉鏈夊涓尮閰嶏紙鐞嗚涓婁笉搴旇锛岄櫎闈瀞ample_id瀛楃涓叉牸寮忓厑璁搁噸澶嶆垨璁捐鏈夌己闄凤級锛岃繑鍥炵涓€涓?
            // 鎴栬€呭彲浠ユ牴鎹笟鍔￠€昏緫閫夋嫨鏇村悎閫傜殑澶勭悊鏂瑰紡锛屼緥濡傛姏鍑哄紓甯告垨璁板綍璀﹀憡
            return datasets.get(0);
        }
        return null;
    }
    @Override
    public List<Dataset> getDataSet() {
        return datasetMapper.getDataSet();
    }

    @Override
    public boolean addDataSet(Dataset dataset) {
        dataset.setSampleNum(0);
        if (dataset.getSetType() == null || dataset.getSetType().trim().isEmpty()) {
            dataset.setSetType("service");
        }
        boolean succeed = save(dataset);
        return succeed;
    }
    @Override
    public boolean editDataSet(Dataset dataset) {
        boolean succeed = updateById(dataset);
        return succeed;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteDataset(Integer id) {
        Dataset dataset = getById(id);
        if (dataset == null) {
            throw new RuntimeException("褰卞儚闆嗕笉瀛樺湪");
        }

        String setType = dataset.getSetType();
        String setName = dataset.getName();

        if ("service".equals(setType)) {
            // 1. 鏌ヨ璇ュ奖鍍忛泦涓嬬殑鎵€鏈夋湇鍔?
            List<Server> servers = serverService.getServersBySetName(setName);

            // 2. 鍒犻櫎 GeoServer 涓殑瀛樺偍锛坈overagestore锛岃繛甯?coverage锛?
            for (Server server : servers) {
                String serName = server.getSerName();
                boolean deleted = geoServerService.deleteStore(serName);
                if (!deleted) {
                    logger.warn("GeoServer coveragestore 鍒犻櫎鍙兘澶辫触: {}", serName);
                }
            }

            // 3. 鍒犻櫎鏈嶅姟璁板綍
            serverService.deleteServersBySetName(setName);

        } else if ("local".equals(setType)) {
            // TODO: 鏈湴褰卞儚闆嗗垹闄ら€昏緫 - 鍒犻櫎鏈湴鏂囦欢绯荤粺涓殑鏂囦欢
            logger.warn("鏈湴褰卞儚闆嗗垹闄ゅ姛鑳藉皻鏈疄鐜帮紝鏆傚彧鍒犻櫎鏁版嵁搴撳拰 MinIO 璁板綍: id={}, name={}", id, setName);
        } else {
            throw new RuntimeException("鏈煡鐨勫奖鍍忛泦绫诲瀷: " + setType);
        }

        // 鏌ヨ璇ュ奖鍍忛泦涓嬬殑鎵€鏈夋枃浠?
        QueryWrapper<SysFile> fileQuery = new QueryWrapper<>();
        fileQuery.eq("dataset_id", id);
        if (setName != null && !setName.trim().isEmpty()) {
            fileQuery.or(wrapper -> wrapper.isNull("dataset_id").eq("set_name", setName));
        }
        List<SysFile> files = sysFileService.list(fileQuery);
        Set<String> deletedObjectNames = new HashSet<>();
        for (SysFile file : files) {
            // 1) 鍒犻櫎 MinIO 涓殑鏂囦欢锛堜娇鐢?AmazonS3锛屼笌 SysFileController 淇濇寔涓€鑷达級
            String fileName = file.getFileName();
            if (fileName != null && !fileName.trim().isEmpty() && deletedObjectNames.add(fileName)) {
                try {
                    if (amazonS3.doesObjectExist(minioConfig.getBucketName(), fileName)) {
                        amazonS3.deleteObject(minioConfig.getBucketName(), fileName);
                        logger.info("MinIO 鏂囦欢鍒犻櫎鎴愬姛: {}", fileName);
                    } else {
                        logger.warn("MinIO 鏂囦欢涓嶅瓨鍦紝璺宠繃: {}", fileName);
                    }
                } catch (Exception e) {
                    logger.error("MinIO 鏂囦欢鍒犻櫎澶辫触: {}", fileName, e);
                }
            }
            // 2) 鍒犻櫎鏁版嵁搴撹褰?+ 婧簮 + 褰卞儚闆嗘暟閲忓洖鍐?
            if (file.getFileId() != null) {
                sysFileService.deleteFileById(file.getFileId());
            }
        }

        // 鍒犻櫎褰卞儚闆?
        removeById(id);
    }
}

