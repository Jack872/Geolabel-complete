package com.example.labelMark.service.impl;

import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.labelMark.domain.SysUser;
import com.example.labelMark.mapper.SysUserMapper;
import com.example.labelMark.service.SysUserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 *
 * @since 2024-04-15
 */
@Service
public class SysUserServiceImpl extends ServiceImpl<SysUserMapper, SysUser> implements SysUserService {
    @Autowired
    private SysUserMapper SysUserMapper;

    /**
     * 创建用户
     *
     * @param user
     * @return
     */
    @Override
    public int createUser(SysUser user) {
        return SysUserMapper.insert(user);
    }

    @Override
    public SysUser findByUsername(String username) {
        QueryWrapper<SysUser> queryWrapper = new QueryWrapper();
//        queryWrapper.and(i -> i.eq("username", username)
//                .eq("userpassword", password));
        queryWrapper.eq("username", username);
        return getOne(queryWrapper);
    }

    @Override
    public SysUser findByUserId(Integer userid) {
        QueryWrapper<SysUser> queryWrapper = new QueryWrapper();
        queryWrapper.eq("user_id", userid);  // Changed from "userid" to "user_id"
        return getOne(queryWrapper);
    }

    @Override
    public boolean resetPassword(SysUser user) {
//        重置密码为88888888
        user.setUserpassword(
                new BCryptPasswordEncoder().encode("88888888"));
        return saveOrUpdate(user);
    }

    @Override
    public long getUsersCountByAdmin(int isAdmin) {
        QueryWrapper<SysUser> queryWrapper = new QueryWrapper();
        queryWrapper.eq("is_admin", isAdmin);
        long count = count(queryWrapper);
        return count;
    }

    /**
     * 根据管理员状态和团队ID获取用户数量
     *
     * @param isAdmin 管理员状态
     * @param teamId 团队ID
     * @return 用户数量
     */
    @Override
    public long getUsersCountByAdminAndTeamId(int isAdmin, Integer teamId) {
        QueryWrapper<SysUser> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("is_admin", isAdmin);
        queryWrapper.eq("team_id", teamId);
        return count(queryWrapper);
    }

    @Override
    public long getTotalCount() {
        return count();
    }

    @Override
    public Page<SysUser> getUsersPage(Integer current, Integer pageSize, String userid, String username, Integer isAdmin) {
        Page<SysUser> userPage = new Page<SysUser>().setCurrent(current).setSize(pageSize);
        QueryWrapper<SysUser> SysUserQueryWrapper = new QueryWrapper<>();
        applyUserSearchFilters(SysUserQueryWrapper, userid, username);
//        SysUserQueryWrapper.eq("is_admin", isAdmin);
        SysUserQueryWrapper.orderBy(true, true, "user_id");
        return page(userPage, SysUserQueryWrapper);
    }

    /**
     * 获取指定团队的用户分页列表
     *
     * @param current 当前页
     * @param pageSize 每页大小
     * @param userid 用户ID
     * @param username 用户名
     * @param isAdmin 是否管理员
     * @param teamId 团队ID
     * @return 用户分页列表
     */
    @Override
    public Page<SysUser> getUsersPageByTeamId(Integer current, Integer pageSize, String userid, String username,
                                          Integer isAdmin, Integer teamId) {
        Page<SysUser> userPage = new Page<SysUser>().setCurrent(current).setSize(pageSize);
        QueryWrapper<SysUser> SysUserQueryWrapper = new QueryWrapper<>();

        applyUserSearchFilters(SysUserQueryWrapper, userid, username);

        if (isAdmin != null) {
            SysUserQueryWrapper.eq("is_admin", isAdmin);
        }
        SysUserQueryWrapper.eq("team_id", teamId);
        SysUserQueryWrapper.orderBy(true, true, "user_id");

        return page(userPage, SysUserQueryWrapper);
    }

    private void applyUserSearchFilters(QueryWrapper<SysUser> queryWrapper, String userid, String username) {
        if (StrUtil.isNotBlank(userid)) {
            queryWrapper.apply("CAST(user_id AS TEXT) LIKE {0}", "%" + userid.trim() + "%");
        }
        if (StrUtil.isNotBlank(username)) {
            queryWrapper.like("username", username.trim());
        }
    }

    @Override
    public boolean deleteUserById(Integer userid) {
        boolean isRemove = removeById(userid);
        return isRemove;
    }

    @Override
    public boolean updateUser(Integer userid, String username, Integer isadmin, Integer teamId) {
        SysUser SysUser = new SysUser();
        SysUser.setUserid(userid);
        if (ObjectUtil.isNotNull(isadmin)) {
            SysUser.setIsadmin(isadmin);
        }
        if (StrUtil.isNotBlank(username)) {
            SysUser.setUsername(username);
        }
        SysUser.setTeamId(teamId);
        boolean isUpdate = updateById(SysUser);
        return isUpdate;
    }

    /**
     * 根据管理员ID获取其团队ID
     *
     * @param adminUserId 管理员用户ID
     * @return 团队ID
     */
    @Override
    public Integer getAdminTeamId(Integer adminUserId) {
        SysUser admin = findByUserId(adminUserId);
        if (admin != null) {
            return admin.getTeamId();
        }
        return null;
    }

    /**
     * 获取指定团队下所有非管理员用户
     *
     * @param teamId 团队ID
     * @return 用户列表
     */
    @Override
    public List<SysUser> getUsersByTeamIdAndNotAdmin(Integer teamId) {
        QueryWrapper<SysUser> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("team_id", teamId);
        queryWrapper.eq("is_admin", 0);
        return list(queryWrapper);
    }

    /**
     * 获取所有非指定团队且非管理员的用户
     *
     * @param teamId 团队ID
     * @return 用户列表
     */
    @Override
    public List<SysUser> getNonTeamUsersAndNotAdmin(Integer teamId) {
        QueryWrapper<SysUser> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("is_admin", 0); // is_admin 为 0 表示普通用户
        if (teamId != null) {
            queryWrapper.and(wrapper -> wrapper.ne("team_id", teamId).or().isNull("team_id"));
        }
        return list(queryWrapper);
    }

    /**
     * 获取所有非管理员用户
     *
     * @return 所有非管理员用户列表
     */
    @Override
    public List<SysUser> getAllNonAdminUsers() {
        QueryWrapper<SysUser> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("is_admin", 0);
        return list(queryWrapper);
    }

    /**
     * 更新用户的团队ID
     *
     * @param userId 用户ID
     * @param teamId 团队ID
     * @return 更新是否成功
     */
    @Override
    public boolean updateUserTeamId(Integer userId, Integer teamId) {
        SysUser user = new SysUser();
        user.setUserid(userId);
        user.setTeamId(teamId);
        return updateById(user);
    }

}
