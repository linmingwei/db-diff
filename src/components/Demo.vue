<template>
  <n-button @click="showModal = true">
    来吧
  </n-button>
  <n-modal v-model:show="showModal" :mask-closable="false" preset="dialog" title="确认" content="你确认" positive-text="确认"
           negative-text="算了" @positive-click="onPositiveClick" @negative-click="onNegativeClick">
    <n-form ref="formRef" :model="model" :rules="rules" label-placement="left" label-width="auto"
            require-mark-placement="right-hanging" :size="size" :style="{
                maxWidth: '640px'
            }">
      <n-form-item label="host" path="inputValue">
        <n-input v-model:value="model.host" placeholder="localhost"/>
      </n-form-item>
      <n-form-item label="port" path="inputValue">
        <n-input v-model:value="model.port" placeholder="1433"/>
      </n-form-item>
      <n-form-item label="username" path="inputValue">
        <n-input v-model:value="model.username" placeholder="user"/>
      </n-form-item>
      <n-form-item label="password" path="inputValue">
        <n-input v-model:value="model.password" placeholder="password"/>
      </n-form-item>
      <n-form-item label="database" path="inputValue">
        <n-input v-model:value="model.database" placeholder="database name"/>
      </n-form-item>
    </n-form>
  </n-modal>
</template>

<script lang="ts">
import {defineComponent, ref} from 'vue'
import { FormInst, FormItemRule, useMessage } from 'naive-ui'

export default defineComponent({
  setup() {
    const message = useMessage()
    const showModalRef = ref(false)
    const formRef = ref<FormInst | null>(null)
    const model =  ref({
      host: null,
      port: null,
      username: null,
      password: null,
      database: null,
      nestedValue: {
        path1: null,
        path2: null
      },
    })

    return {
      showModal: showModalRef,
      formRef,
      model: model,
      onNegativeClick() {
        message.success('Cancel')
        showModalRef.value = false
      },
      onPositiveClick() {
        console.log(model)

        message.success('Submit')
        showModalRef.value = false
      }
    }
  }
})
</script>