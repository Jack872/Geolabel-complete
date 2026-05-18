package com.example.labelMark.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * @version 1.0
 * @description： 遥感影像切片服务类
 * @createDate 2024/4/17
 */
public interface GeoServerService {
    String getCoverageInfo(Integer serId);

    ResponseEntity<byte[]> getGeoserverImg(String layerName, int width, int height, String bbox, String srs);

    String publish(String storeName,String seryear,String setName);
    
    String publish(String storeName,String seryear,String setName, String coordinateSystem);

    ResponseEntity<String> createGeoServerStore(String storeName, String filePath) throws IOException, InterruptedException;

    boolean checkStoreExists(String luu, String sername);

    boolean checkCoverageExists(String luu, String sername);

    ResponseEntity<String> createRemoteGeoServerStore(String sername, String minioHttpUrl) throws IOException, InterruptedException;

    /**
     * 删除 GeoServer 中的 coveragestore（连带删除 coverage）
     * @param storeName 存储名称
     * @return true 如果删除成功或资源不存在
     */
    boolean deleteStore(String storeName);
}
