import java.sql.*;

public class DbProbe {
  public static void main(String[] args) throws Exception {
    String url = "jdbc:postgresql://localhost:5432/geolabel?stringtype=unspecified";
    String user = "postgres";
    String pwd = "88888888";
    try (Connection c = DriverManager.getConnection(url, user, pwd)) {
      System.out.println("connected=" + !c.isClosed());
      String[] tables = {"task", "task_item", "mark", "task_accepted", "taskaccept"};
      for (String t : tables) {
        try (PreparedStatement ps = c.prepareStatement("select count(*) from " + t);
             ResultSet rs = ps.executeQuery()) {
          rs.next();
          System.out.println(t + "=" + rs.getInt(1));
        } catch (Exception ex) {
          System.out.println(t + "=N/A (" + ex.getMessage() + ")");
        }
      }
      try (PreparedStatement ps = c.prepareStatement("select task_id, task_name from task where task_name like ? order by task_id")) {
        ps.setString(1, "whu_building_test%");
        try (ResultSet rs = ps.executeQuery()) {
          int n = 0;
          while (rs.next()) {
            n++;
            System.out.println("task=" + rs.getInt(1) + " name=" + rs.getString(2));
          }
          System.out.println("matched=" + n);
        }
      }
    }
  }
}
