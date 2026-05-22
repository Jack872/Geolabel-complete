import { PageContainer } from '@ant-design/pro-layout';
import SharedDatasetTab from '../datasetStore/component/sharedDatasetTab';
import { useModel } from 'umi';
import './style.less';

export default function SharedDataset() {
  const { initialState } = useModel('@@initialState');
  const currentState = initialState?.currentState || {};

  return (
    <PageContainer
      header={false}
      className="shared-dataset-page"
    >
      <SharedDatasetTab currentState={currentState} />
    </PageContainer>
  );
} 