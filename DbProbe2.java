import java.sql.*;

public class DbProbe2 {
  public static void main(String[] args) throws Exception {
    String url = "jdbc:postgresql://localhost:5432/geolabel?stringtype=unspecified";
    String user = "postgres";
    String pwd = "88888888";
    try (Connection c = DriverManager.getConnection(url, user, pwd)) {
      try (PreparedStatement ps = c.prepareStatement(
          "select t.task_id, t.task_name, count(i.task_item_id) as item_cnt from task t left join task_item i on t.task_id=i.task_id where t.task_name like ? group by t.task_id, t.task_name order by t.task_id")) {
        ps.setString(1, "whu_building_test%");
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            System.out.println("task=" + rs.getInt("task_id") + " name=" + rs.getString("task_name") + " items=" + rs.getInt("item_cnt"));
          }
        }
      }

      try (PreparedStatement ps = c.prepareStatement(
          "select task_item_id, item_index, item_name, task_source, map_server, local_image_path from task_item where task_id=? order by item_index, task_item_id")) {
        ps.setInt(1, 73);
        try (ResultSet rs = ps.executeQuery()) {
          int n=0;
          while (rs.next()) {
            n++;
            System.out.println(n + ": itemId=" + rs.getInt("task_item_id") + ", idx=" + rs.getInt("item_index") + ", name=" + rs.getString("item_name"));
          }
          System.out.println("task73_items=" + n);
        }
      }
    }
  }
}
