import { Menu, app } from "electron";

export function installAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Skill Hub",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
      ],
    },
  ];

  if (process.platform !== "darwin") {
    template[0].submenu = [{ role: "quit", label: "退出" }];
  }

  app.applicationMenu = Menu.buildFromTemplate(template);
}
