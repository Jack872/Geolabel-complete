/*import { PageContainer } from '@ant-design/pro-layout';
import TabChild from './component/tabChild';
import { useModel } from 'umi';
import './style.less';
import React, { useState } from 'react';

export default function datasetStore() {
  const { initialState } = useModel('@@initialState');
  const currentState = initialState?.currentState || {};

  return (
    <PageContainer
      title="样本集管理"
      subTitle="管理您的标注样本数据，支持下载和发布共享"
      className="dataset-store-page"
    >
      <TabChild currentState={currentState} />
    </PageContainer>
  );
}*/

import React from 'react';
import { PageContainer } from '@ant-design/pro-layout';
import { useModel } from 'umi';
// 引入重构后的组件 (请确保 DatasetReleaseManage.jsx 文件已创建并路径正确)
import DatasetReleaseManage from './component/DatasetReleaseManage';


export default function DatasetStore() {
  // 获取全局状态
  const { initialState } = useModel('@@initialState');
  // 保持原有逻辑获取 currentState
  const currentState = initialState || {};

  return (
    <PageContainer
      title="样本集仓库"
      subTitle="查看已生成的合并数据集，支持预览统计、多格式转换 (COCO/YOLO/VOC) 与打包下载"
      className="dataset-store-page"
      // 建议设置高度以适应内部的 Flex 布局和滚动条
      style={{ height: 'calc(100vh - 100px)' }}
    >
      {/* 传入 currentState 以便内部获取 currentUser 信息 */}
      <DatasetReleaseManage currentState={currentState} />
    </PageContainer>
  );
}

