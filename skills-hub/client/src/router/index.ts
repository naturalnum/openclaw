import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "skills",
    component: () => import("@/views/SkillsView.vue"),
  },
  {
    path: "/skills/:slug",
    name: "skill-detail",
    component: () => import("@/views/SkillDetailView.vue"),
    props: true,
  },
  {
    path: "/upload",
    name: "upload",
    component: () => import("@/views/UploadView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/admin/reviews",
    name: "reviews",
    component: () => import("@/views/admin/ReviewsView.vue"),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/admin/reviews/:versionId",
    name: "review-detail",
    component: () => import("@/views/admin/ReviewDetailView.vue"),
    props: (route) => ({ versionId: Number(route.params.versionId) }),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/admin/users",
    name: "users",
    component: () => import("@/views/admin/UsersView.vue"),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
