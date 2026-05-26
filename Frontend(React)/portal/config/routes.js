export default [
  {
    path: '/user',
    layout: false,
    routes: [
      {
        path: '/user',
        routes: [
          {
            name: 'login',
            path: '/user/login',
            component: './user/Login',
          },
          {
            name: 'register',
            path: '/user/register',
            component: './user/Register',
          },
        ],
      },
      {
        component: './404',
      },
    ],
  },
  {
    name: 'home',
    icon: 'profile',
    path: '/home',
    component: './home/index.jsx',
  },
  // {
  //   access: 'canAdmin',
  //   name: 'list.org-list',
  //   icon: 'profile',
  //   path: '/orglist',
  //   component: './orgManage',
  // },
  {
    access: 'canAdmin',
    name: 'list.user-list',
    path: '/userlist',
    icon: 'user',
    component: './userManage',
  },
  {
    name: 'list.datamanage',
    path: '/dataManage',
    icon: 'crown',
    component: './dataManage/vectorManage',
  },
  {
    access: 'canUser',
    path: '/personalTaskList',
    name: 'list.personalTaskList',
    icon: 'user',
    component: './personalTaskList',
  },
  {
    icon: 'crown',
    path: '/taskmanage',
    name: 'list.taskmanage',
    component: './taskManage',
  },
  {
    name: 'category',
    path: '/category',
    icon: 'profile',
    component: './Category',
  }, // 数据管理
  {
    name: 'list.servicemanage',
    path: '/servicemanage',
    icon: 'crown',
    component: './serviceManage',
  },
  {
    icon: 'crown',
    path: '/datasetStore',
    name: 'list.datasetStore',
    component: './datasetStore',
  },
  {
    icon: 'crown',
    path: '/prov',
    name: 'list.prov',
    component: './prov',
  },
  {
    // access: 'canUser',
    path: '/modelManage',
    name: 'list.modelManage',
    icon: 'appstore',
    component: './modelManage',
  },
  {
    path: '/map',
    name: 'list.map',
    component: './markPage',
    icon: 'crown',
    hideInMenu: true,
    // 新页面打开
    target: '_blank',
    // 不展示顶栏
    headerRender: false,
    // 不展示页脚
    footerRender: false,
    // 不展示菜单
    menuRender: false,
    // 不展示菜单顶栏
    menuHeaderRender: false,
  },
  {
    path: '/auditPage',
    name: 'list.auditPage',
    component: './auditPage',
    icon: 'crown',
    hideInMenu: true,
    // 新页面打开
    target: '_blank',
    // 不展示顶栏
    headerRender: false,
    // 不展示页脚
    footerRender: false,
    // 不展示菜单
    menuRender: false,
    // 不展示菜单顶栏
    menuHeaderRender: false,
  },
  {
    path: '/',
    redirect: '/home',
  },
  {
    component: './404',
  },
];
