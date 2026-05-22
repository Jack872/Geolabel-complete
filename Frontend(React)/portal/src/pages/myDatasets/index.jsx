import { PageContainer } from '@ant-design/pro-layout';
import MyDatasetTab from '../datasetStore/component/myDatasetTab';
import { useModel } from 'umi';
import './style.less';

export default function MyDatasets() {
  const { initialState } = useModel('@@initialState');
  const currentState = initialState?.currentState || {};

  return (
    <PageContainer
      header={false}
      className="my-datasets-page"
    >
      <MyDatasetTab currentState={currentState} />
    </PageContainer>
  );
} 