import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
  state: () => ({
    popupVisible: false,
    popupTitle: '' as string,
    popupMessage: '' as string,
  }),
  actions: {
    showInfo(message: string, title = 'Aviso') {
      this.popupTitle = title
      this.popupMessage = message
      this.popupVisible = true
    },
    hidePopup() {
      this.popupVisible = false
    },
  },
})
