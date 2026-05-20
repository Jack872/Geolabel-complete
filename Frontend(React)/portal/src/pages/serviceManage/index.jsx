import { ProList } from '@ant-design/pro-components';
import {
  DeleteTwoTone, UserOutlined, CalendarOutlined, ClockCircleOutlined, SearchOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-layout';
import { Tag, Popconfirm, Button, message, Input, Skeleton, Empty, Typography } from 'antd';
import { useModel } from 'umi';
import { useState, useEffect, useMemo } from 'react';
import { reqDeleteService } from '@/services/serviceManage/api';
import MyDrawer from './components/MyDrawer.jsx';
import './css.css';

const { Text, Paragraph } = Typography;

export default () => {
  const [currentService, setCurrentService] = useState(null);
  const [visible, setVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const { serverList, getServerList } = useModel('serverModel');
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      setPageLoading(true);
      await getServerList(true);
      setPageLoading(false);
    };
    init();
  }, []);

  // 搜索过滤
  const filteredList = useMemo(() => {
    if (!searchText.trim()) return serverList;
    const kw = searchText.toLowerCase();
    return serverList.filter(
      (item) =>
        item.serName?.toLowerCase().includes(kw) ||
        item.serDesc?.toLowerCase().includes(kw) ||
        item.publisher?.toLowerCase().includes(kw),
    );
  }, [serverList, searchText]);

  const showDetail = (item) => {
    setCurrentService(item);
    setVisible(true);
  };

  const handleDelete = async (item) => {
    try {
      const result = await reqDeleteService(item.serName);
      if (result) {
        message.success('删除成功！');
        await getServerList(true);
      }
    } catch (error) {
      message.error('删除失败！');
    }
  };

  const dataSource = filteredList.map((item) => ({ ...item, id: item.serName }));

  return (
    <PageContainer>
      {/* 工具栏 */}
      <div className="list-toolbar">
        <Input
          placeholder="搜索服务名称、描述或发布人..."
          allowClear
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 380 }}
        />
        <Text type="secondary" className="list-total">
          共 {filteredList.length} 个服务
        </Text>
      </div>

      {/* 加载中 */}
      {pageLoading ? (
        <div className="list-skeleton">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} active avatar paragraph={{ rows: 2 }} />
          ))}
        </div>
      ) : filteredList.length === 0 ? (
        /* 空状态 */
        <div className="list-empty">
          <Empty description={searchText ? '没有匹配的服务' : '暂无服务数据'}>
            {false && searchText && (
              <Button type="primary" ghost onClick={() => setSearchText('')}>
                清除搜索
              </Button>
            )}
          </Empty>
        </div>
      ) : (
        /* 服务列表 */
        <ProList
          rowKey="id"
          dataSource={dataSource}
          showActions="always"
          pagination={{
            defaultPageSize: 5,
            showSizeChanger: true,
            pageSizeOptions: ['5', '10', '20', '50'],
            showTotal: (total) => `共 ${total} 条`,
          }}
          metas={{
            title: {
              render: (_, item) => (
                <Text strong style={{ fontSize: 16 }}>
                  {item.serName}
                </Text>
              ),
            },
            description: {
              render: (_, item) => (
                <div className="item-tags">
                  {item.publisher && (
                    <Tag icon={<UserOutlined />} color="default">
                      {item.publisher}
                    </Tag>
                  )}
                  {item.serYear && (
                    <Tag icon={<CalendarOutlined />} color="blue">
                      {item.serYear}
                    </Tag>
                  )}
                  {item.publishTime && (
                    <Tag icon={<ClockCircleOutlined />} color="cyan">
                      {item.publishTime}
                    </Tag>
                  )}
                </div>
              ),
            },
            content: {
              render: (_, item) => (
                <div className="item-desc">
                  {item.serDesc && (
                    <Paragraph
                      type="secondary"
                      ellipsis={{ rows: 2 }}
                      style={{ marginBottom: 0, fontSize: 13 }}
                    >
                      {item.serDesc}
                    </Paragraph>
                  )}
                </div>
              ),
            },
            actions: {
              render: (_, item) => [
                <Button
                  key="detail"
                  className="btn-detail"
                  icon={<CalendarOutlined />}
                  size="small"
                  onClick={() => showDetail(item)}
                >
                  详情
                </Button>,
                <Popconfirm
                  key="delete"
                  title="确定要删除该服务吗？"
                  onConfirm={() => handleDelete(item)}
                >
                  <Button
                    className="btn-delete"
                    icon={<DeleteTwoTone twoToneColor="#ff4d4f" />}
                    size="small"
                  >
                    删除
                  </Button>
                </Popconfirm>,
              ],
            },
          }}
        />
      )}

      {/* 详情抽屉 */}
      <MyDrawer
        content={currentService}
        visible={visible}
        onClose={() => {
          setVisible(false);
          setCurrentService(null);
        }}
      />
    </PageContainer>
  );
};
