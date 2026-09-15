export function WorkflowNavigation({
  section,
  onNavigate,
}: {
  section: string;
  onNavigate: (section: string) => void;
}) {
  return (
    <nav aria-label="项目流程">
      {[
        ["upload", "上传"],
        ["review", "评审"],
        ["script", "讲稿"],
        ["versions", "版本"],
      ].map(([value, label]) => (
        <button
          key={value}
          aria-current={section === value ? "page" : undefined}
          className={section === value ? "active" : ""}
          onClick={() => onNavigate(value ?? "review")}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
