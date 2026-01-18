<template>
  <footer class="my-footer">
    <div class="footer-content">
      <div class="footer-info">
        <p class="powered-by">Powered by VuePress Plume</p>
        &nbsp;|&nbsp;
        <p class="contact-email">Created by <a href="mailto:minjor@minjor.com">Minjor</a></p>
        <p class="copyright">© {{ currentYear }} Minjor. All rights reserved.</p>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const currentYear = new Date().getFullYear()
</script>

<style scoped>
.my-footer {
  text-align: center;
}

.footer-content {
  max-width: 768px;
  margin: 0 auto;
  padding: 0 0.5rem;
}

.footer-info p {
  font-size: 0.9rem;
  color: #666;
}

.powered-by {
  display: inline;
  font-style: italic;
}

.contact-email{
  display: inline;
}
</style>