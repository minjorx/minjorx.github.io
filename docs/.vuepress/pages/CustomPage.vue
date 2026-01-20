<!-- .vuepress/components/CustomPage.vue -->
<template>
  <div class="custom-page">
    <h1>自定义页面</h1>
    <p>这是一个独立的 Vue 页面，不参与文档处理</p>
    <button @click="count++">点击次数：{{ count }}</button>
  </div>
</template>

<script>
export default {
  name: "CustomPage",
  data() {
    return {
      count: 0,
    };
  },
};
</script>

<style scoped>
.custom-page {
  padding: 2rem;
  text-align: center;
}
</style>
