import { Mark } from "@tiptap/core";

export const DiffAddMark = Mark.create({
  name: "diffAdd",
  renderHTML() { return ["span", { class: "seg-add" }, 0]; },
});

export const DiffDelMark = Mark.create({
  name: "diffDel",
  renderHTML() { return ["span", { class: "seg-del" }, 0]; },
});

export const DiffModOldMark = Mark.create({
  name: "diffModOld",
  renderHTML() { return ["span", { class: "seg-mod-old" }, 0]; },
});

export const DiffModNewMark = Mark.create({
  name: "diffModNew",
  renderHTML() { return ["span", { class: "seg-mod-new" }, 0]; },
});

export const UserAddMark = Mark.create({
  name: "userAdd",
  renderHTML() { return ["span", { class: "seg-user-add" }, 0]; },
});

export const UserDelMark = Mark.create({
  name: "userDel",
  renderHTML() { return ["span", { class: "seg-user-del" }, 0]; },
});

export const diffMarks = [
  DiffAddMark, DiffDelMark, DiffModOldMark, DiffModNewMark,
  UserAddMark, UserDelMark,
];
