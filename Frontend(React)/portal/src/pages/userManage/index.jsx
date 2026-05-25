import { Tabs, Card, Button, message, Avatar, Select, Popconfirm, Input, Tooltip } from 'antd';
// 引入头像icon
import { DeleteOutlined, EditOutlined, RedoOutlined, UserOutlined, TeamOutlined } from '@ant-design/icons';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useModel, useAccess, useIntl } from 'umi';
import { PageContainer } from '@ant-design/pro-layout';
import { ProCard, ProTable } from '@ant-design/pro-components';
import styles from './style.css';
import {
  reqGetUserList,
  reqNewUser,
  reqDeleteUser,
  reqEditUser,
  reqResetPassword,
} from '@/services/userManage/api';
import { reqCreateTeam, reqGetMyTeamCode, reqGetTeamList } from '@/services/teamManage/api';
import CollectionCreateForm from './components/index.jsx';
import CreateTeamForm from './components/CreateTeamForm.jsx';

const App = () => {
  const intl = useIntl();
  const t = (id, defaultMessage, values) => intl.formatMessage({ id, defaultMessage }, values);
  const actionRef = useRef();
  const [visible, setVisible] = useState(false);
  const [teamFormVisible, setTeamFormVisible] = useState(false);
  const [initialValue, setInitialValue] = useState({});
  const [teamCode, setTeamCode] = useState(null);
  const [searchUserid, setSearchUserid] = useState('');
  const [searchUsername, setSearchUsername] = useState('');
  const [searchTeamId, setSearchTeamId] = useState(null);
  const [teamOptions, setTeamOptions] = useState([]);
  const { userList, getUserList } = useModel('userModel');
  const searchTimerRef = useRef();
  const access = useAccess();

  // 搜索条件变化时自动刷新（防抖）
  useEffect(() => {
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      actionRef.current?.reload();
    }, 300);
  }, [searchUserid, searchUsername]);

  // 获取当前管理员的团队码
  const getMyTeamCode = useCallback(async () => {
    if (access.canAdmin) {
      try {
        const result = await reqGetMyTeamCode();
        if (result.code == 200 && result.data) {
          setTeamCode(result.data.teamCode);
        }
      } catch (error) {
        console.error('获取团队码失败:', error);
      }
    }
  }, [access.canAdmin]);

  const getTeamList = useCallback(async () => {
    if (!access.canAdmin) {
      setTeamOptions([]);
      return;
    }
    try {
      const result = await reqGetTeamList();
      if (result.code == 200) {
        setTeamOptions(result.data || []);
      }
    } catch (error) {
      console.error('获取团队列表失败:', error);
    }
  }, [access.canAdmin]);

  useEffect(() => {
    getMyTeamCode();
    getTeamList();
  }, [getMyTeamCode, getTeamList]);

  const onCreate = async (values) => {
    const hide = message.loading(t('common.loading.edit', '正在修改'));
    setVisible(false);
    try {
      const payload = {
        ...values,
        teamId: values.teamId ? Number(values.teamId) : null,
      };
      let result = await reqEditUser(payload);
      hide();
      if (result.code == 200) {
        message.success(t('common.success.edit', '修改成功！'));
        // 刷新并清空,页码也会重置，不包括表单
        actionRef.current.reload();
      } else {
        message.error(t('user.duplicate', '用户名重复！'));
      }
    } catch (error) {
      hide();
      message.error(t('common.error.server', '服务器异常，请稍后重试！'));
      setVisible(false);
      return;
    }
  };

  // 创建团队处理
  const handleCreateTeam = async (values) => {
    const hide = message.loading(t('user.team.create', '创建团队'));
    setTeamFormVisible(false);
    try {
      const result = await reqCreateTeam(values);
      hide();
      if (result.code == 200) {
        message.success(t('user.team.create.success', '团队创建成功！'));
        setTeamCode(result.data.teamCode);
        getTeamList();
      } else {
        message.error(result.message || t('user.team.create.failed', '创建失败！'));
      }
    } catch (error) {
      hide();
      message.error(t('common.error.server', '服务器异常，请稍后重试！'));
      return;
    }
  };

  return (
    <PageContainer header={false}>
      <ProCard style={{ marginTop: 8 }} gutter={8} ghost>
        <ProCard layout="left" bordered className={styles.content}>
          <div className={styles.title}>
            {visible && (
              <CollectionCreateForm
                defaultValue={initialValue}
                teamOptions={teamOptions}
                visible={visible}
                onCreate={onCreate}
                onCancel={() => {
                  setVisible(false);
                }}
              />
            )}
            {teamFormVisible && (
              <CreateTeamForm
                visible={teamFormVisible}
                onCreate={handleCreateTeam}
                onCancel={() => {
                  setTeamFormVisible(false);
                }}
              />
            )}
          </div>
          {access.canAdmin && (
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Tooltip title={teamCode ? t('user.team.created', '已创建团队') : null}>
                  <Button
                    type="primary"
                    icon={<TeamOutlined />}
                    onClick={() => setTeamFormVisible(true)}
                    disabled={!!teamCode}
                    style={{ marginRight: 16 }}
                  >
                    {t('user.team.create', '创建团队')}
                  </Button>
                </Tooltip>
                {teamCode && (
                  <div style={{ marginLeft: 16 }}>
                    <strong>{t('user.team.code', '团队码:')}</strong> {teamCode}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Select
                  placeholder={t('user.team', '所属团队')}
                  value={searchTeamId}
                  onChange={(val) => setSearchTeamId(val)}
                  style={{ width: 150 }}
                  allowClear
                  options={teamOptions.map((t) => ({ label: t.name, value: t.teamId }))}
                />
                <Input
                  placeholder={t('user.search.id', '用户编号')}
                  value={searchUserid}
                  onChange={(e) => setSearchUserid(e.target.value)}
                  style={{ width: 150 }}
                  allowClear
                />
                <Input
                  placeholder={t('user.search.name', '用户名')}
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  style={{ width: 150 }}
                  allowClear
                />
              </div>
            </div>
          )}
          <div>
            <UserTable
              actionRef={actionRef}
              setVisible={setVisible}
              setInitialValue={setInitialValue}
              searchUserid={searchUserid}
              searchUsername={searchUsername}
              searchTeamId={searchTeamId}
              teamOptions={teamOptions}
              // setid={setid}
              // getDataSource={getDataSource}
            />
          </div>
          {/* <Access accessible={!access.canAdmin} fallback={<div>Can not delete foo.</div>}>
              Delete foo.
            </Access> */}
        </ProCard>
      </ProCard>
    </PageContainer>
  );
};


const UserTable = (props) => {
  const intl = useIntl();
  const t = (id, defaultMessage, values) => intl.formatMessage({ id, defaultMessage }, values);
  const { setVisible, setInitialValue, actionRef, teamOptions, searchUserid, searchUsername, searchTeamId } = props;

  const getTeamName = (teamId) => {
    const team = teamOptions.find((item) => item.teamId === teamId);
    return team ? team.name : t('user.team.unassigned', '未分配');
  };

  const confirm = async (id) => {
    let res = await reqDeleteUser(id);
    if (res.code == 200) {
      message.success(t('common.success.delete', '删除成功！'));
      actionRef.current.reload();
    } else {
      message.error(t('user.delete.failed.admin', '删除失败，请联系管理员'));
    }
  };

  const resetpwd = async (userid) => {
    let res = await reqResetPassword({ userid });
    if (res.code) {
      message.success(t('user.reset.success', '重置密码成功'));
    } else {
      message.error(t('user.reset.failed', '重置密码失败，请联系开发人员'));
    }
  };

  const columns = [
    {
      title: t('user.id', '用户编号'),
      dataIndex: 'userid',
      align: 'center',
      key: 'userid',
      valueType: 'text',
    },
    {
      title: t('user.name', '用户名'),
      dataIndex: 'username',
      key: 'username',
      align: 'center',
      ellipsis: true,
    },

    // {
    //   title: '已完成项目数',
    //   dataIndex: 'finishednum',
    //   key: 'finishednum',
    //   search: false,
    //   align: 'center',
    //   // ellipsis: false,
    // },
    // {
    //   title: '未完成项目数',
    //   dataIndex: 'unfinishednum',
    //   key: 'unfinishednum',
    //   search: false,
    //   align: 'center',
    //   // ellipsis: false,
    // },
    {
      title: t('user.role', '权限'),
      dataIndex: 'isadmin',
      key: 'isadmin',
      valueEnum: { 1: t('user.role.admin', '管理员'), 0: t('user.role.normal', '普通用户') },
      search: false,
      align: 'center',
    },
    {
      title: t('user.team', '所属团队'),
      dataIndex: 'teamId',
      key: 'teamId',
      search: false,
      align: 'center',
      render: (_, record) => getTeamName(record.teamId),
    },
    {
      title: t('common.operation', '操作'),
      dataIndex: 'operate',
      search: false,
      align: 'center',
      // ellipsis: false,
      render: (text, record) => {
        return (
          <React.Fragment>
            <EditOutlined
              style={{ color: 'green', marginRight: '10px' }}
              title={t('common.edit', '编辑')}
              key="update"
              onClick={async () => {
                setInitialValue({
                  userid: record.userid,
                  isadmin: String(record.isadmin),
                  username: record.username,
                  teamId: record.teamId != null ? String(record.teamId) : undefined,
                });
                setVisible(true);
              }}
            />
            <Popconfirm
              title={t('user.delete.confirm', '你确定要删除吗?')}
              onConfirm={() => {
                confirm(record.userid);
              }}
              okText={t('common.yes', '是')}
              cancelText={t('common.no', '否')}
            >
              <DeleteOutlined
                key="delete"
                style={{ color: 'red', marginRight: '10px' }}
                title={t('common.delete', '删除')}
              />
            </Popconfirm>
            <Popconfirm
              title={t('user.reset.confirm', '你确定要重置密码吗?')}
              key="confirmReset"
              onConfirm={() => {
                resetpwd(record.userid);
              }}
              okText={t('common.yes', '是')}
              cancelText={t('common.no', '否')}
            >
              <RedoOutlined style={{ color: '#1890ff' }} title={t('user.reset.password', '重置密码')} key="reset" />
            </Popconfirm>
          </React.Fragment>
        );
      },
    },
  ];

  return (
    <ProTable
      params={{ userid: searchUserid, username: searchUsername, teamId: searchTeamId }}
      request={reqGetUserList}
      /*request={async (
      )=>{
        const msg = await reqGetUserList({
          isAdmin: params.isAdmin,
          pageSize: params.pageSize,
          current: params.current,
          userid: params.userid,
          username: params.username,
        });
        debugger
        return {
          data: msg.data.usersPage.records,
          // success 请返回 true，
          // 不然 table 会停止解析数据，即使有数据
          success: msg.code===200?true:false,
          // 不传会使用 data 的长度，如果是分页一定要传
          total: msg.data.total,
        };
      }}*/
      columns={columns}
      actionRef={actionRef}
      search={false}
      rowKey="userid"
      pagination={{
        pageSizeOptions: ['5', '10', '15', '20'],
        defaultPageSize: 5,
        showSizeChanger: true,
      }}
    />
    // <Table rowKey="id" />
  );
};

export default App;
