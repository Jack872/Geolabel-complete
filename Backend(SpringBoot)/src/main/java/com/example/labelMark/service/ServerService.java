package com.example.labelMark.service;

import com.example.labelMark.domain.Server;
import com.baomidou.mybatisplus.extension.service.IService;

import java.util.List;
import java.util.Map;

/**
 * <p>
 *  服务类
 * </p>
 *
 *
 * @since 2024-05-16
 */
public interface ServerService extends IService<Server> {

    List<Server> getServers(Integer userId);

    int deleteServerByName(String serName);

    boolean createServer(Server server);

    /**
     * 按照影像集名称分组获取服务
     * @param userId 用户ID
     * @return Map<String, List<String>> 键为影像集名称，值为该影像集下的服务名称列表
     */
    Map<String, List<String>> getServersBySetName(Integer userId);
    /**
     * 批量发布文件到 GeoServer 并记录溯源
     * @param fileIds 文件ID列表
     * @param userId 当前操作人ID
     * @param username 当前操作人用户名
     * @throws Exception 发布失败抛出异常
     */
    void publishServices(List<Integer> fileIds, Integer userId, String username) throws Exception;

    /**
     * 根据影像集名称查询服务列表
     * @param setName 影像集名称
     * @return 服务列表
     */
    List<Server> getServersBySetName(String setName);

    /**
     * 根据影像集名称删除所有服务
     * @param setName 影像集名称
     * @return 删除数量
     */
    int deleteServersBySetName(String setName);
}
